"""Entry point: python -m src"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from src.models import SOURCES_CONFIG, DataFile, Source
from src.normalizer import deduplicate_methods
from src.parsers import telegram, github_readme, xbox_dns_ru, xbox_news_ru, github_skorches, teletype_faqi, sport24, xboxstor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("main")

DATA_DIR = Path("data")
DATA_FILE = DATA_DIR / "data.json"

# Маппинг source_id → функция парсера
PARSERS = {
    "src-xboxnews-ru": telegram.parse,
    "src-xbox-dns": telegram.parse,
    "src-chipslays": github_readme.parse,
    "src-xbox-dns-ru": xbox_dns_ru.parse,
    "src-xbox-news-ru": xbox_news_ru.parse,
    "src-skorches": github_skorches.parse,
    "src-teletype-faqi": teletype_faqi.parse,
    "src-sport24": sport24.parse,
    "src-xboxstor": xboxstor.parse,
}


def load_existing_data() -> DataFile | None:
    """Загружает существующий data.json, если есть."""
    if DATA_FILE.exists():
        try:
            with open(DATA_FILE, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, KeyError):
            log.warning("data.json повреждён, начинаем с нуля")
    return None


def save_data(data: DataFile) -> None:
    """Сохраняет data.json."""
    DATA_DIR.mkdir(exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    log.info("Сохранено %d методов в %s", len(data["methods"]), DATA_FILE)


def run() -> None:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    all_methods = []
    sources_status: list[Source] = []

    # Ручные записи (от пользователей, не из парсеров)
    from src.normalizer import generate_method_id
    manual_methods = [
        {
            "id": generate_method_id("dns_pair", "31.129.110.240"),
            "type": "dns_pair", "difficulty": "easy",
            "primary_dns": "31.129.110.240", "secondary_dns": None,
            "description": None,
            "sources": ["manual"], "source_urls": [],
            "first_seen": "2026-04-10", "last_seen": today,
            "active": True, "recheck": False, "instruction_url": None,
        },
    ]
    all_methods.extend(manual_methods)

    for cfg in SOURCES_CONFIG:
        source_id = cfg["id"]
        parser_fn = PARSERS.get(source_id)
        if not parser_fn:
            log.warning("Нет парсера для %s", source_id)
            continue

        log.info("Парсинг: %s (%s)", cfg["name"], cfg["url"])

        source_result: Source = {
            "id": source_id,
            "name": cfg["name"],
            "type": cfg["type"],
            "url": cfg["url"],
            "last_parsed": now,
            "status": "ok",
            "error_message": None,
        }

        try:
            methods = parser_fn(cfg["url"], source_id, today)
            all_methods.extend(methods)
            log.info("  → найдено %d методов", len(methods))
        except Exception as e:
            log.error("  → ошибка: %s", e)
            source_result["status"] = "error"
            source_result["error_message"] = type(e).__name__

        sources_status.append(source_result)

    # Дедупликация
    unique_methods = deduplicate_methods(all_methods)
    log.info("Всего уникальных методов: %d (из %d до дедупликации)", len(unique_methods), len(all_methods))

    # Merge с существующими данными (Фаза 3)
    existing = load_existing_data()
    if existing:
        from src.merger import merge
        final_methods = merge(existing["methods"], unique_methods, today)
    else:
        final_methods = unique_methods

    # Автопроверка DNS (v0.2)
    # IPv6 не проверяется — GitHub Actions не поддерживают IPv6
    from src.checker import check_dns
    from datetime import datetime as _dt, timezone as _tz
    dns_cache: dict[str, dict] = {}
    checked = 0
    ipv6_skipped = 0
    for method in final_methods:
        if method.get("type") != "dns_pair":
            continue
        primary = method.get("primary_dns")
        if not primary or primary == "0.0.0.0":
            continue
        # IPv6 — особая обработка
        if ":" in primary:
            method["dns_check"] = {
                "status": "ipv6_unchecked",
                "checked_at": _dt.now(_tz.utc).isoformat(timespec="seconds"),
                "resolved_ip": None,
            }
            ipv6_skipped += 1
            continue
        if primary in dns_cache:
            method["dns_check"] = dns_cache[primary]
            continue
        log.info("Проверка DNS: %s", primary)
        result = check_dns(primary)
        dns_cache[primary] = result
        method["dns_check"] = result
        log.info("  → %s (IP: %s)", result["status"], result.get("resolved_ip"))
        checked += 1
    log.info("Проверено DNS: %d уникальных, IPv6 пропущено: %d", checked, ipv6_skipped)

    # Автопроверка xsts IP (v1.0.3)
    from src.checker import check_xsts_ip
    xsts_cache: dict[str, dict] = {}
    xsts_checked = 0
    for method in final_methods:
        if method.get("type") != "xsts_ip":
            continue
        ip = method.get("primary_dns")
        if not ip:
            continue
        if ip in xsts_cache:
            method["dns_check"] = xsts_cache[ip]
            continue
        log.info("Проверка xsts IP: %s", ip)
        result = check_xsts_ip(ip)
        xsts_cache[ip] = result
        method["dns_check"] = result
        log.info("  → %s", result["status"])
        xsts_checked += 1
    log.info("Проверено xsts IP: %d уникальных", xsts_checked)

    data: DataFile = {
        "updated_at": now,
        "methods": final_methods,
        "sources": sources_status,
    }

    save_data(data)


def main() -> None:
    try:
        run()
    except KeyboardInterrupt:
        log.info("Прервано пользователем")
        sys.exit(1)


if __name__ == "__main__":
    main()
