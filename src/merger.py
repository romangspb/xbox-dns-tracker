"""Слияние новых данных с существующим data.json."""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from src.models import Method

log = logging.getLogger(__name__)

MAX_INACTIVE_DAYS = 60  # 2 месяца без появления → active: false


def merge(existing: list[Method], new: list[Method], today: str) -> list[Method]:
    """Сливает новые методы с существующими.

    Логика:
    - Существующий метод найден в новых → обновляем last_seen, объединяем sources
    - Существующий метод НЕ найден → проверяем давность, помечаем неактивным если > 2 мес.
    - Новый метод не в существующих → добавляем
    - Неактивный метод появился снова → recheck: true
    """
    existing_by_id = {m["id"]: m for m in existing}
    new_by_id = {m["id"]: m for m in new}
    result: dict[str, Method] = {}

    # Обработка существующих методов
    for mid, old_m in existing_by_id.items():
        if mid in new_by_id:
            new_m = new_by_id[mid]
            updated = dict(old_m)

            # Обновляем last_seen
            updated["last_seen"] = today

            # Объединяем sources
            for src in new_m.get("sources", []):
                if src not in updated.get("sources", []):
                    updated.setdefault("sources", []).append(src)

            # Объединяем source_urls
            for url in new_m.get("source_urls", []):
                if url not in updated.get("source_urls", []):
                    updated.setdefault("source_urls", []).append(url)

            # Если был неактивным — пометить recheck
            if not old_m.get("active", True):
                updated["active"] = True
                updated["recheck"] = True
                log.info("  Recheck: %s снова появился в источниках", mid)

            result[mid] = updated
        else:
            # Метод не найден в новых данных
            updated = dict(old_m)
            last_seen = old_m.get("last_seen", today)
            days_since = _days_between(last_seen, today)

            if days_since > MAX_INACTIVE_DAYS and old_m.get("active", True):
                updated["active"] = False
                log.info("  Деактивация: %s (не появлялся %d дней)", mid, days_since)

            result[mid] = updated

    # Добавление новых методов
    for mid, new_m in new_by_id.items():
        if mid not in result:
            result[mid] = new_m
            log.info("  Новый метод: %s (%s)", mid, new_m.get("primary_dns", ""))

    return list(result.values())


def _days_between(date_str1: str, date_str2: str) -> int:
    """Считает количество дней между двумя датами YYYY-MM-DD."""
    try:
        d1 = datetime.strptime(date_str1, "%Y-%m-%d")
        d2 = datetime.strptime(date_str2, "%Y-%m-%d")
        return abs((d2 - d1).days)
    except (ValueError, TypeError):
        return 0
