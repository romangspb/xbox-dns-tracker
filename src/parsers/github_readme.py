"""Парсер README chipslays/0x80a40401 — markdown-таблица с DNS."""

from __future__ import annotations

import logging
import re

import httpx

from src.models import Method
from src.normalizer import normalize_ip, generate_method_id

log = logging.getLogger(__name__)

TIMEOUT = 15

# Статус маппинг из emoji
_STATUS_MAP = {
    "✅": "working",
    "☑": "reported_working",
    "❌": "not_working",
}


def _parse_table_row(row: str) -> dict | None:
    """Парсит одну строку markdown-таблицы. Возвращает dict или None."""
    cells = [c.strip() for c in row.split("|")]
    # Убираем пустые ячейки от начального и конечного |
    cells = [c for c in cells if c != ""]

    if len(cells) < 4:
        return None

    primary_raw = cells[0].strip()
    secondary_raw = cells[1].strip() if len(cells) > 1 else ""
    # Убираем markdown-ссылки и лишнее
    primary_raw = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", primary_raw)
    secondary_raw = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", secondary_raw)

    primary = normalize_ip(primary_raw)
    if not primary:
        return None

    secondary = normalize_ip(secondary_raw) if secondary_raw and secondary_raw != "—" else None

    status_raw = cells[3].strip() if len(cells) > 3 else ""
    status = "unknown"
    for emoji, s in _STATUS_MAP.items():
        if emoji in status_raw:
            status = s
            break

    return {
        "primary": primary,
        "secondary": secondary,
        "status": status,
    }


def _extract_xsts_ips(text: str) -> list[str]:
    """Извлекает IP-адреса xsts из секции 'Список известных IP адресов'."""
    ips = []
    xsts_section = False
    for line in text.split("\n"):
        # Точный маркер начала секции
        if "известных ip" in line.lower():
            xsts_section = True
            continue
        if xsts_section:
            stripped = line.strip()
            # Конец секции: закрывающий тег details или новый заголовок верхнего уровня
            if stripped.startswith("</details") or (stripped.startswith("#") and not stripped.startswith("###")):
                break
            ip_match = re.findall(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b", line)
            for ip_raw in ip_match:
                ip = normalize_ip(ip_raw)
                if ip:
                    ips.append(ip)
    return ips


def parse(url: str, source_id: str, today: str) -> list[Method]:
    """Парсит README chipslays/0x80a40401 и извлекает DNS-пары + xsts IP."""
    resp = httpx.get(url, timeout=TIMEOUT, follow_redirects=True)
    resp.raise_for_status()
    text = resp.text

    methods: list[Method] = []
    source_url = "https://github.com/chipslays/0x80a40401"

    # Парсим таблицу DNS
    in_table = False
    header_passed = False
    for line in text.split("\n"):
        stripped = line.strip()

        # Начало таблицы: строка с | и IP-подобным содержимым
        if "|" in stripped:
            cells = [c.strip() for c in stripped.split("|")]
            cells = [c for c in cells if c != ""]

            # Пропускаем заголовок и разделитель
            if any("---" in c for c in cells):
                header_passed = True
                continue
            if any(word in stripped.lower() for word in ["основной", "дополнительный", "скорость"]):
                in_table = True
                continue

            if in_table and header_passed:
                row_data = _parse_table_row(stripped)
                if row_data:
                    mid = generate_method_id("dns_pair", row_data["primary"], row_data["secondary"])
                    methods.append({
                        "id": mid,
                        "type": "dns_pair",
                        "difficulty": "easy",
                        "primary_dns": row_data["primary"],
                        "secondary_dns": row_data["secondary"],
                        "description": None,
                        "sources": [source_id],
                        "source_urls": [source_url],
                        "first_seen": today,
                        "last_seen": today,
                        "active": True,
                        "recheck": False,
                        "instruction_url": None,
                    })

    # Парсим xsts IP
    xsts_ips = _extract_xsts_ips(text)
    for ip in xsts_ips:
        mid = generate_method_id("xsts_ip", ip)
        methods.append({
            "id": mid,
            "type": "xsts_ip",
            "difficulty": "medium",
            "primary_dns": ip,
            "secondary_dns": None,
            "description": None,
            "sources": [source_id],
            "source_urls": [source_url],
            "first_seen": today,
            "last_seen": today,
            "active": True,
            "recheck": False,
            "instruction_url": None,
        })

    return methods
