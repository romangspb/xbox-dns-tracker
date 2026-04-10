"""Парсер xboxstor.ru — статья с DNS-адресами."""

from __future__ import annotations

import logging

import httpx
from bs4 import BeautifulSoup

from src.models import Method
from src.normalizer import extract_ipv4, generate_method_id

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
TIMEOUT = 15


def parse(url: str, source_id: str, today: str) -> list[Method]:
    """Парсит статью xboxstor.ru."""
    resp = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=True)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")
    methods: list[Method] = []

    content = soup.select_one("article") or soup.select_one(".t-container") or soup.body
    if not content:
        return []

    text = content.get_text(separator="\n")
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue

        ipv4 = extract_ipv4(line)
        if not ipv4:
            continue

        if len(ipv4) == 2:
            primary, secondary = ipv4[0], ipv4[1]
            mid = generate_method_id("dns_pair", primary, secondary)
            methods.append({
                "id": mid, "type": "dns_pair", "difficulty": "easy",
                "primary_dns": primary, "secondary_dns": secondary, "description": None,
                "sources": [source_id], "source_urls": [url],
                "first_seen": today, "last_seen": today,
                "active": True, "recheck": False, "instruction_url": url,
            })
        elif len(ipv4) == 1:
            mid = generate_method_id("dns_pair", ipv4[0])
            methods.append({
                "id": mid, "type": "dns_pair", "difficulty": "easy",
                "primary_dns": ipv4[0], "secondary_dns": None, "description": None,
                "sources": [source_id], "source_urls": [url],
                "first_seen": today, "last_seen": today,
                "active": True, "recheck": False, "instruction_url": url,
            })

    return methods
