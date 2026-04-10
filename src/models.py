"""Структуры данных проекта."""

from __future__ import annotations

from typing import TypedDict, Literal


class Method(TypedDict, total=False):
    """Один способ обхода (DNS-пара, xsts IP, VPN и т.д.)."""
    id: str
    type: Literal["dns_pair", "xsts_ip", "vpn", "router", "other"]
    difficulty: Literal["easy", "medium", "hard"]
    primary_dns: str | None
    secondary_dns: str | None
    description: str | None
    sources: list[str]          # id источников
    source_urls: list[str]      # прямые ссылки на пост/страницу
    first_seen: str             # YYYY-MM-DD
    last_seen: str              # YYYY-MM-DD
    active: bool
    recheck: bool
    instruction_url: str | None


class Source(TypedDict, total=False):
    """Источник данных."""
    id: str
    name: str
    type: Literal["telegram", "github", "website"]
    url: str
    last_parsed: str            # ISO 8601
    status: Literal["ok", "error", "unavailable"]
    error_message: str | None


class DataFile(TypedDict):
    """Корневая структура data.json."""
    updated_at: str             # ISO 8601
    methods: list[Method]
    sources: list[Source]


# Конфигурация источников
SOURCES_CONFIG: list[Source] = [
    {
        "id": "src-xboxnews-ru",
        "name": "Xbox News RU (Telegram)",
        "type": "telegram",
        "url": "https://t.me/s/xboxnews_ru",
    },
    {
        "id": "src-xbox-dns",
        "name": "Xbox DNS (Telegram)",
        "type": "telegram",
        "url": "https://t.me/s/xbox_dns",
    },
    {
        "id": "src-chipslays",
        "name": "chipslays/0x80a40401",
        "type": "github",
        "url": "https://raw.githubusercontent.com/chipslays/0x80a40401/main/README.md",
    },
    {
        "id": "src-xbox-dns-ru",
        "name": "xbox-dns.ru",
        "type": "website",
        "url": "https://xbox-dns.ru",
    },
    {
        "id": "src-xbox-news-ru",
        "name": "xbox-news.ru",
        "type": "website",
        "url": "https://xbox-news.ru/news/1049425/",
    },
    {
        "id": "src-skorches",
        "name": "skorches/xbox-dns-bypass",
        "type": "github",
        "url": "https://github.com/skorches/xbox-dns-bypass",
    },
    {
        "id": "src-teletype-faqi",
        "name": "teletype.in/@faqi (гайд)",
        "type": "website",
        "url": "https://teletype.in/@faqi/Nastroyka-DNS-dlya-Xbox-Series-X-S-v-Rossii-2025-o",
    },
    {
        "id": "src-sport24",
        "name": "sport24.ru (гайд)",
        "type": "website",
        "url": "https://sport24.ru/cybersport/article-kak-oboyti-oshibku-regiona-na-xbox",
    },
]
