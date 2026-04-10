"""Парсер teletype.in/@faqi — гайд с DNS и региональными вариантами."""

from __future__ import annotations

import logging

import httpx
from bs4 import BeautifulSoup

from src.models import Method
from src.normalizer import extract_ipv4, normalize_ip, generate_method_id

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
TIMEOUT = 15


def parse(url: str, source_id: str, today: str) -> list[Method]:
    """Парсит гайд teletype.in/@faqi."""
    resp = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=True)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")
    methods: list[Method] = []

    content = soup.select_one("article") or soup.select_one(".content") or soup.body
    if not content:
        return []

    text = content.get_text(separator="\n")
    lines = text.split("\n")

    # Контекст xsts
    xsts_context_ips = set()
    for i, line in enumerate(lines):
        if "xsts" in line.lower():
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

        is_xsts = "xsts" in line.lower() or any(ip in xsts_context_ips for ip in ipv4_in_line)

        if is_xsts:
            for ip in ipv4_in_line:
                mid = generate_method_id("xsts_ip", ip)
                methods.append({
                    "id": mid, "type": "xsts_ip", "difficulty": "medium",
                    "primary_dns": ip, "secondary_dns": None, "description": None,
                    "sources": [source_id], "source_urls": [url],
                    "first_seen": today, "last_seen": today,
                    "active": True, "recheck": False, "instruction_url": url,
                })
        elif len(ipv4_in_line) == 2:
            primary, secondary = ipv4_in_line[0], ipv4_in_line[1]
            mid = generate_method_id("dns_pair", primary, secondary)
            methods.append({
                "id": mid, "type": "dns_pair", "difficulty": "easy",
                "primary_dns": primary, "secondary_dns": secondary, "description": None,
                "sources": [source_id], "source_urls": [url],
                "first_seen": today, "last_seen": today,
                "active": True, "recheck": False, "instruction_url": url,
            })
        elif len(ipv4_in_line) == 1:
            mid = generate_method_id("dns_pair", ipv4_in_line[0])
            methods.append({
                "id": mid, "type": "dns_pair", "difficulty": "easy",
                "primary_dns": ipv4_in_line[0], "secondary_dns": None, "description": None,
                "sources": [source_id], "source_urls": [url],
                "first_seen": today, "last_seen": today,
                "active": True, "recheck": False, "instruction_url": url,
            })

    return methods
