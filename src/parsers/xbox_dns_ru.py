"""Парсер xbox-dns.ru — Smart DNS сервис."""

from __future__ import annotations

import logging

import httpx
from bs4 import BeautifulSoup

from src.models import Method
from src.normalizer import normalize_ip, extract_ipv6, generate_method_id

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
TIMEOUT = 15


def parse(url: str, source_id: str, today: str) -> list[Method]:
    """Парсит xbox-dns.ru и извлекает DNS-адреса из <code> тегов."""
    resp = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=True)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")
    methods: list[Method] = []

    # Ищем все <code> теги — DNS адреса там
    code_tags = soup.find_all("code")
    ipv4_list = []
    ipv6_list = []

    for tag in code_tags:
        text = tag.get_text().strip()
        ip = normalize_ip(text)
        if ip:
            if ":" in ip:
                ipv6_list.append(ip)
            else:
                ipv4_list.append(ip)

    # IPv4 пары
    if len(ipv4_list) >= 2:
        for i in range(0, len(ipv4_list) - 1, 2):
            primary, secondary = ipv4_list[i], ipv4_list[i + 1]
            mid = generate_method_id("dns_pair", primary, secondary)
            methods.append({
                "id": mid,
                "type": "dns_pair",
                "difficulty": "easy",
                "primary_dns": primary,
                "secondary_dns": secondary,
                "description": "Smart DNS от xbox-dns.ru",
                "sources": [source_id],
                "source_urls": [url],
                "first_seen": today,
                "last_seen": today,
                "active": True,
                "recheck": False,
                "instruction_url": url,
            })
    elif len(ipv4_list) == 1:
        mid = generate_method_id("dns_pair", ipv4_list[0])
        methods.append({
            "id": mid,
            "type": "dns_pair",
            "difficulty": "easy",
            "primary_dns": ipv4_list[0],
            "secondary_dns": None,
            "description": "Smart DNS от xbox-dns.ru",
            "sources": [source_id],
            "source_urls": [url],
            "first_seen": today,
            "last_seen": today,
            "active": True,
            "recheck": False,
            "instruction_url": url,
        })

    # IPv6 пары
    if len(ipv6_list) >= 2:
        for i in range(0, len(ipv6_list), 2):
            primary = ipv6_list[i]
            secondary = ipv6_list[i + 1] if i + 1 < len(ipv6_list) else None
            mid = generate_method_id("dns_pair", primary, secondary)
            methods.append({
                "id": mid,
                "type": "dns_pair",
                "difficulty": "easy",
                "primary_dns": primary,
                "secondary_dns": secondary,
                "description": "Smart DNS IPv6 от xbox-dns.ru",
                "sources": [source_id],
                "source_urls": [url],
                "first_seen": today,
                "last_seen": today,
                "active": True,
                "recheck": False,
                "instruction_url": url,
            })

    return methods
