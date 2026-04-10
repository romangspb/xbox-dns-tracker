"""Парсер xbox-news.ru — статья с DNS-адресами."""

from __future__ import annotations

import logging
import re

import httpx
from bs4 import BeautifulSoup

from src.models import Method
from src.normalizer import extract_ipv4, extract_ipv6, normalize_ip, generate_method_id

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
TIMEOUT = 15


def parse(url: str, source_id: str, today: str) -> list[Method]:
    """Парсит статью xbox-news.ru и извлекает DNS-пары."""
    resp = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=True)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")
    methods: list[Method] = []

    # Основной контент статьи
    content = soup.select_one(".entry-content")
    if not content:
        content = soup.select_one("article")
    if not content:
        content = soup.body

    if not content:
        log.warning("Не найден контент на %s", url)
        return []

    text = content.get_text(separator="\n")

    # Ищем DNS-пары: строки вида "IP / IP" или "Основной: IP, Дополнительный: IP"
    lines = text.split("\n")

    # Определяем контекст xsts — ищем секцию где упоминается xsts/роутер
    xsts_context_ips = set()
    for i, line in enumerate(lines):
        if "xsts" in line.lower():
            # IP в ближайших 3 строках относятся к xsts
            for j in range(max(0, i - 2), min(len(lines), i + 4)):
                for ip in extract_ipv4(lines[j]):
                    xsts_context_ips.add(ip)

    for line in lines:
        line = line.strip()
        if not line:
            continue

        ipv4_in_line = extract_ipv4(line)
        if not ipv4_in_line:
            continue

        # Определяем тип по контексту
        is_xsts = "xsts" in line.lower() or any(ip in xsts_context_ips for ip in ipv4_in_line)

        if is_xsts:
            for ip in ipv4_in_line:
                mid = generate_method_id("xsts_ip", ip)
                methods.append({
                    "id": mid,
                    "type": "xsts_ip",
                    "difficulty": "medium",
                    "primary_dns": ip,
                    "secondary_dns": None,
                    "description": None,
                    "sources": [source_id],
                    "source_urls": [url],
                    "first_seen": today,
                    "last_seen": today,
                    "active": True,
                    "recheck": False,
                    "instruction_url": url,
                })
        elif len(ipv4_in_line) == 2:
            # Пара IP в одной строке → DNS-пара
            primary, secondary = ipv4_in_line[0], ipv4_in_line[1]
            mid = generate_method_id("dns_pair", primary, secondary)
            methods.append({
                "id": mid,
                "type": "dns_pair",
                "difficulty": "easy",
                "primary_dns": primary,
                "secondary_dns": secondary,
                "description": None,
                "sources": [source_id],
                "source_urls": [url],
                "first_seen": today,
                "last_seen": today,
                "active": True,
                "recheck": False,
                "instruction_url": url,
            })
        elif len(ipv4_in_line) == 1:
            # Одиночный IP — DNS с secondary = None
            mid = generate_method_id("dns_pair", ipv4_in_line[0])
            methods.append({
                "id": mid,
                "type": "dns_pair",
                "difficulty": "easy",
                "primary_dns": ipv4_in_line[0],
                "secondary_dns": None,
                "description": None,
                "sources": [source_id],
                "source_urls": [url],
                "first_seen": today,
                "last_seen": today,
                "active": True,
                "recheck": False,
                "instruction_url": url,
            })

    # IPv6
    ipv6_in_text = extract_ipv6(text)
    if ipv6_in_text:
        for i in range(0, len(ipv6_in_text), 2):
            primary = ipv6_in_text[i]
            secondary = ipv6_in_text[i + 1] if i + 1 < len(ipv6_in_text) else None
            mid = generate_method_id("dns_pair", primary, secondary)
            methods.append({
                "id": mid,
                "type": "dns_pair",
                "difficulty": "easy",
                "primary_dns": primary,
                "secondary_dns": secondary,
                "description": None,
                "sources": [source_id],
                "source_urls": [url],
                "first_seen": today,
                "last_seen": today,
                "active": True,
                "recheck": False,
                "instruction_url": url,
            })

    return methods
