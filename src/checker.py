"""Автопроверка DNS: работает ли bypass и безопасен ли DNS."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import dns.resolver

log = logging.getLogger(__name__)

# Домен авторизации Xbox — его блокировка вызывает 0x80a40401
XSTS_DOMAIN = "xsts.auth.xboxlive.com"

# Домен для проверки безопасности (не должен подменяться)
SAFETY_DOMAIN = "google.com"

# Стандартные Azure-подсети Xbox Live (первые 2 октета)
# Если xsts резолвится в эти подсети — bypass НЕ работает
AZURE_PREFIXES = ("20.", "40.", "52.")

TIMEOUT = 5  # секунд
GOOGLE_DNS = "8.8.8.8"


def _resolve(nameserver: str, domain: str) -> list[str]:
    """Резолвит домен через указанный DNS-сервер."""
    resolver = dns.resolver.Resolver()
    resolver.nameservers = [nameserver]
    resolver.lifetime = TIMEOUT
    result = resolver.resolve(domain, "A")
    return [str(ip) for ip in result]


def _is_azure_ip(ip: str) -> bool:
    """Проверяет, принадлежит ли IP стандартным Azure-диапазонам Xbox Live."""
    return any(ip.startswith(prefix) for prefix in AZURE_PREFIXES)


def _same_subnet_16(ips_a: list[str], ips_b: list[str]) -> bool:
    """Проверяет что хотя бы один IP из каждого списка в одной /16 подсети."""
    subnets_a = {".".join(ip.split(".")[:2]) for ip in ips_a}
    subnets_b = {".".join(ip.split(".")[:2]) for ip in ips_b}
    return bool(subnets_a & subnets_b)


def check_safety(nameserver: str) -> bool:
    """Проверяет что DNS не подменяет обычные домены.
    Сравнивает резолв google.com с Google DNS по /16 подсети.
    Возвращает True если безопасен."""
    try:
        bypass_ips = _resolve(nameserver, SAFETY_DOMAIN)
        google_ips = _resolve(GOOGLE_DNS, SAFETY_DOMAIN)
        return _same_subnet_16(bypass_ips, google_ips)
    except Exception:
        # Если не можем проверить — считаем безопасным (не блокируем)
        return True


def check_dns(primary_dns: str) -> dict:
    """Проверяет DNS-сервер: обходит ли блокировку и безопасен ли.

    Возвращает dict для поля dns_check в Method:
    {status, checked_at, resolved_ip}
    """
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    result = {
        "status": "unchecked",
        "checked_at": now,
        "resolved_ip": None,
    }

    # Проверка bypass
    try:
        ips = _resolve(primary_dns, XSTS_DOMAIN)
        resolved_ip = ips[0] if ips else None
        result["resolved_ip"] = resolved_ip

        if resolved_ip and _is_azure_ip(resolved_ip):
            result["status"] = "not_working"
        elif resolved_ip:
            result["status"] = "working"
        else:
            result["status"] = "error"

    except dns.resolver.LifetimeTimeout:
        result["status"] = "timeout"
        log.debug("  Timeout: %s", primary_dns)
        return result
    except dns.resolver.NXDOMAIN:
        result["status"] = "error"
        log.debug("  NXDOMAIN: %s", primary_dns)
        return result
    except Exception as e:
        result["status"] = "error"
        log.debug("  Error: %s — %s", primary_dns, type(e).__name__)
        return result

    # Проверка безопасности (только если bypass работает)
    if result["status"] == "working":
        if not check_safety(primary_dns):
            result["status"] = "unsafe"
            log.warning("  UNSAFE: %s подменяет %s", primary_dns, SAFETY_DOMAIN)

    return result
