"""Парсер skorches/xbox-dns-bypass — минимальный, для v0.2 больше пригодится."""

from __future__ import annotations

import logging

import httpx

from src.models import Method
from src.normalizer import extract_ipv4, generate_method_id

log = logging.getLogger(__name__)

TIMEOUT = 15
# README со списком доменов и скриптов, но без DNS IP
RAW_URL = "https://raw.githubusercontent.com/skorches/xbox-dns-bypass/main/README.md"


def parse(url: str, source_id: str, today: str) -> list[Method]:
    """Парсит skorches/xbox-dns-bypass README. Основная польза — для v0.2 (валидация)."""
    resp = httpx.get(RAW_URL, timeout=TIMEOUT, follow_redirects=True)
    resp.raise_for_status()
    text = resp.text

    methods: list[Method] = []
    source_url = "https://github.com/skorches/xbox-dns-bypass"

    # Извлекаем IP если есть (README может обновиться)
    ips = extract_ipv4(text)
    if not ips:
        log.info("  skorches: IP не найдены в README (ожидаемо, данные в скриптах)")
        return []

    # Если вдруг появились IP — сохраняем как DNS-пары
    for i in range(0, len(ips) - 1, 2):
        primary, secondary = ips[i], ips[i + 1]
        mid = generate_method_id("dns_pair", primary, secondary)
        methods.append({
            "id": mid,
            "type": "dns_pair",
            "difficulty": "easy",
            "primary_dns": primary,
            "secondary_dns": secondary,
            "description": None,
            "sources": [source_id],
            "source_urls": [source_url],
            "first_seen": today,
            "last_seen": today,
            "active": True,
            "recheck": False,
            "instruction_url": source_url,
        })

    return methods
