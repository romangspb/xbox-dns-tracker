"""Парсер Telegram-каналов через публичный preview t.me/s/."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone, timedelta

import httpx
from bs4 import BeautifulSoup

from src.models import Method
from src.normalizer import extract_ipv4, extract_ipv6, normalize_ip, generate_method_id

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
TIMEOUT = 15
MAX_AGE_DAYS = 60  # 2 месяца


def _fetch_page(url: str) -> str:
    """Загружает HTML страницы t.me/s/."""
    resp = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


def _parse_date(time_tag) -> datetime | None:
    """Извлекает дату из <time datetime='...'>."""
    if not time_tag or not time_tag.get("datetime"):
        return None
    try:
        dt_str = time_tag["datetime"]
        # Формат: 2026-04-10T12:00:00+00:00
        return datetime.fromisoformat(dt_str)
    except (ValueError, TypeError):
        return None


def _is_too_old(dt: datetime | None) -> bool:
    """Проверяет, старше ли пост MAX_AGE_DAYS."""
    if dt is None:
        return False  # если нет даты — не фильтруем
    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt < cutoff


def _extract_dns_pairs(ipv4_list: list[str]) -> list[tuple[str, str | None]]:
    """Группирует IP в пары (primary, secondary).
    Логика: берём IP попарно. Если нечётное количество — последний без пары."""
    pairs = []
    i = 0
    while i < len(ipv4_list):
        primary = ipv4_list[i]
        secondary = ipv4_list[i + 1] if i + 1 < len(ipv4_list) else None
        pairs.append((primary, secondary))
        i += 2
    return pairs


def parse(url: str, source_id: str, today: str) -> list[Method]:
    """Парсит Telegram-канал через t.me/s/ и извлекает DNS-пары."""
    html = _fetch_page(url)
    soup = BeautifulSoup(html, "lxml")

    messages = soup.select(".tgme_widget_message_wrap")
    if not messages:
        # Альтернативный селектор
        messages = soup.select("[data-post]")

    if not messages:
        log.warning("Нет постов на %s (возможно изменилась разметка)", url)
        return []

    methods: list[Method] = []

    for msg in messages:
        # Дата поста
        time_tag = msg.select_one("time")
        post_date = _parse_date(time_tag)

        if _is_too_old(post_date):
            continue

        # Текст поста
        text_el = msg.select_one(".tgme_widget_message_text")
        if not text_el:
            continue
        text = text_el.get_text(separator=" ")

        # Ссылка на пост
        post_link = None
        link_el = msg.select_one(".tgme_widget_message_date")
        if link_el and link_el.get("href"):
            post_link = link_el["href"]

        date_str = post_date.strftime("%Y-%m-%d") if post_date else today

        # Извлекаем IPv4
        ipv4_list = extract_ipv4(text)
        if not ipv4_list:
            continue

        # Извлекаем IPv6 (если есть)
        ipv6_list = extract_ipv6(text)

        # Определяем тип: если упоминается xsts — это xsts_ip
        is_xsts = "xsts" in text.lower() or "xboxlive" in text.lower()

        if is_xsts:
            # Каждый IP — отдельный xsts_ip метод
            for ip in ipv4_list:
                mid = generate_method_id("xsts_ip", ip)
                methods.append({
                    "id": mid,
                    "type": "xsts_ip",
                    "difficulty": "medium",
                    "primary_dns": ip,
                    "secondary_dns": None,
                    "description": None,
                    "sources": [source_id],
                    "source_urls": [post_link] if post_link else [],
                    "first_seen": date_str,
                    "last_seen": date_str,
                    "active": True,
                    "recheck": False,
                    "instruction_url": None,
                })
        else:
            # DNS-пары
            pairs = _extract_dns_pairs(ipv4_list)
            for primary, secondary in pairs:
                mid = generate_method_id("dns_pair", primary, secondary)
                methods.append({
                    "id": mid,
                    "type": "dns_pair",
                    "difficulty": "easy",
                    "primary_dns": primary,
                    "secondary_dns": secondary,
                    "description": None,
                    "sources": [source_id],
                    "source_urls": [post_link] if post_link else [],
                    "first_seen": date_str,
                    "last_seen": date_str,
                    "active": True,
                    "recheck": False,
                    "instruction_url": None,
                })

        # IPv6 пары (если есть)
        if ipv6_list:
            for j in range(0, len(ipv6_list), 2):
                v6_primary = ipv6_list[j]
                v6_secondary = ipv6_list[j + 1] if j + 1 < len(ipv6_list) else None
                mid = generate_method_id("dns_pair", v6_primary, v6_secondary)
                methods.append({
                    "id": mid,
                    "type": "dns_pair",
                    "difficulty": "easy",
                    "primary_dns": v6_primary,
                    "secondary_dns": v6_secondary,
                    "description": None,
                    "sources": [source_id],
                    "source_urls": [post_link] if post_link else [],
                    "first_seen": date_str,
                    "last_seen": date_str,
                    "active": True,
                    "recheck": False,
                    "instruction_url": None,
                })

    log.info("  Telegram %s: %d постов, %d методов", url, len(messages), len(methods))
    return methods
