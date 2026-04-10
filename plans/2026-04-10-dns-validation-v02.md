# План: Автопроверка DNS v0.2

**Дата:** 2026-04-10
**Ресёрч:** thoughts/research/2026-04-10-dns-validation-v02.md
**Статус:** completed

---

## Проблема

DNS-пары в data.json не проверены — непонятно, какие реально обходят блокировку Xbox, а какие нет.

## Цель

Автоматически проверять каждый DNS из data.json: обходит ли он блокировку xsts.auth.xboxlive.com и не подменяет ли обычные домены.

## Acceptance Criteria

1. **AC-1:** После парсинга запускается проверка всех dns_pair методов
2. **AC-2:** Каждый dns_pair получает поле `dns_check` с результатом (status, checked_at, resolved_ip)
3. **AC-3:** status = working если resolved IP не в Azure-диапазонах (20.x, 40.x, 52.x)
4. **AC-4:** status = not_working если resolved IP в Azure-диапазонах
5. **AC-5:** status = timeout если DNS не ответил за 5 сек
6. **AC-6:** status = unsafe если DNS подменяет google.com (разница по /16)
7. **AC-7:** xsts_ip методы не проверяются (они сами — целевые IP)
8. **AC-8:** Проверка не ломает существующий парсинг при ошибках

## Scope

- Новый модуль `src/checker.py`
- Обновление `__main__.py` — вызов checker после парсинга
- Обновление `requirements.txt` — dnspython
- Тесты для checker

## Non-Goals

- Проверка DoH/DoT
- Повторные проверки с историей (v1.0)
- Проверка xsts_ip методов

---

## Challenge Log

### Альтернативы

1. **Проверять только xsts резолв** — быстро, но не ловит MitM DNS.
2. **Проверять xsts + safety check** (выбрано) — на 1 запрос больше, но ловит вредоносные DNS.
3. **Проверять через DoH** — сложнее, не нужно для v0.2.

### Нет ли кода ради кода?

- Без абстракций — одна функция `check_dns()` + одна `check_safety()`
- Без retry-логики (v1.0)
- Без истории проверок (v1.0)

---

## Фаза 1: checker.py + интеграция [x]

### Задачи
- [x] Добавить dnspython в requirements.txt
- [x] Написать src/checker.py: check_dns(primary_ip) → dns_check dict
- [x] Safety check: сравнить резолв google.com по /16 подсети
- [x] Интегрировать в __main__.py: после парсинга → проверка dns_pair
- [x] Тесты для checker (mock dns.resolver)
- [x] Кэш проверок: один DNS проверяется один раз

### Что изменится
Было: data.json без информации о работоспособности DNS.
Стало: каждый dns_pair имеет `dns_check: {status, checked_at, resolved_ip}`.

### Итог реализации
Создан src/checker.py: резолв xsts.auth.xboxlive.com через проверяемый DNS, определение Azure IP, safety check google.com по /16. Интегрирован в __main__.py с кэшированием. 14 тестов checker + 56 всего — все зелёные. Реальный прогон: 2 working, 1 not_working, 7 unsafe, ~20 timeout (ожидаемо вне РФ).

---

## Итог

**Реализован целиком: да.**

v0.2 работает: каждый dns_pair автоматически проверяется на bypass и безопасность. Статусы: working, not_working, timeout, error, unsafe. Кэш предотвращает повторные проверки одного DNS.
