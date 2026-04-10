"""Нормализация IP-адресов, генерация ID, дедупликация."""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import re

from src.models import Method

log = logging.getLogger(__name__)

# Regex для IPv4 и IPv6
_IPV4_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
# Лёгкий паттерн для IPv6: ловим кандидатов, валидируем через ipaddress
_IPV6_RE = re.compile(r"[0-9a-fA-F:]{2,39}(?:::[0-9a-fA-F]{1,4}|[0-9a-fA-F]{4})")


def _strip_leading_zeros_ipv4(raw: str) -> str:
    """Убирает ведущие нули из октетов IPv4 (078.022 → 78.22).
    Python ipaddress считает ведущие нули невалидными (неоднозначность octal/decimal)."""
    parts = raw.split(".")
    if len(parts) != 4:
        return raw
    try:
        return ".".join(str(int(p)) for p in parts)
    except ValueError:
        return raw


def normalize_ip(raw: str) -> str | None:
    """Нормализует IP-адрес (IPv4 или IPv6). Возвращает None если невалидный."""
    raw = raw.strip()
    if not raw:
        return None
    # Попытка с ведущими нулями для IPv4
    if "." in raw and ":" not in raw:
        raw = _strip_leading_zeros_ipv4(raw)
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        log.debug("Невалидный IP: %s", raw)
        return None


def extract_ipv4(text: str) -> list[str]:
    """Извлекает все IPv4-адреса из текста. Возвращает нормализованные."""
    results = []
    for match in _IPV4_RE.findall(text):
        normalized = normalize_ip(match)
        if normalized:
            results.append(normalized)
    return results


def extract_ipv6(text: str) -> list[str]:
    """Извлекает все IPv6-адреса из текста. Возвращает нормализованные."""
    results = []
    for match in _IPV6_RE.findall(text):
        normalized = normalize_ip(match)
        if normalized:
            results.append(normalized)
    return results


def extract_all_ips(text: str) -> list[str]:
    """Извлекает все IP-адреса (v4 + v6) из текста."""
    return extract_ipv4(text) + extract_ipv6(text)


def generate_method_id(method_type: str, primary: str | None, secondary: str | None = None, description: str | None = None) -> str:
    """Генерирует стабильный ID для метода на основе его данных."""
    if method_type in ("dns_pair", "xsts_ip") and primary:
        key = f"{method_type}:{primary}:{secondary or ''}"
    elif description:
        key = f"{method_type}:{description}"
    else:
        key = f"{method_type}:{primary or ''}:{secondary or ''}"
    short_hash = hashlib.md5(key.encode()).hexdigest()[:8]
    return f"{method_type[:3]}-{short_hash}"


def _has_real_secondary(m: Method) -> bool:
    """Проверяет, есть ли реальный secondary DNS (не None и не 0.0.0.0)."""
    sec = m.get("secondary_dns")
    return sec is not None and sec != "0.0.0.0"


def deduplicate_methods(methods: list[Method]) -> list[Method]:
    """Дедупликация методов: сначала по ID, потом по primary_dns для dns_pair."""
    # Шаг 1: дедупликация по ID (объединяем sources)
    seen: dict[str, Method] = {}
    for m in methods:
        mid = m["id"]
        if mid in seen:
            existing = seen[mid]
            for src in m.get("sources", []):
                if src not in existing.get("sources", []):
                    existing.setdefault("sources", []).append(src)
            for url in m.get("source_urls", []):
                if url not in existing.get("source_urls", []):
                    existing.setdefault("source_urls", []).append(url)
            if m.get("last_seen", "") > existing.get("last_seen", ""):
                existing["last_seen"] = m["last_seen"]
        else:
            seen[mid] = m

    # Шаг 2: дедупликация dns_pair по primary_dns
    # Один primary — одна карточка (с лучшим secondary)
    by_primary: dict[str, Method] = {}
    result: list[Method] = []

    for m in seen.values():
        if m.get("type") != "dns_pair":
            result.append(m)
            continue

        primary = m.get("primary_dns", "")
        if primary in by_primary:
            existing = by_primary[primary]
            # Объединяем sources
            for src in m.get("sources", []):
                if src not in existing.get("sources", []):
                    existing.setdefault("sources", []).append(src)
            for url in m.get("source_urls", []):
                if url not in existing.get("source_urls", []):
                    existing.setdefault("source_urls", []).append(url)
            # Если текущий имеет реальный secondary, а существующий нет — заменяем
            if _has_real_secondary(m) and not _has_real_secondary(existing):
                existing["secondary_dns"] = m["secondary_dns"]
                existing["id"] = m["id"]
            if m.get("last_seen", "") > existing.get("last_seen", ""):
                existing["last_seen"] = m["last_seen"]
        else:
            by_primary[primary] = m

    result.extend(by_primary.values())
    return result
