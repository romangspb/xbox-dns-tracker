# Ресёрч: Автопроверка DNS v0.2

**Дата:** 2026-04-10

## Как проверить работоспособность DNS

1. Резолв `xsts.auth.xboxlive.com` через проверяемый DNS-сервер
2. Стандартные IP (Azure): 20.x.x.x, 40.x.x.x, 52.x.x.x → DNS НЕ обходит блокировку
3. Любой другой IP → DNS работает как bypass

**Реальные данные (проверено):**
- Google DNS (8.8.8.8) → `40.90.8.102` (Azure)
- xbox-dns.ru (111.88.96.50) → `87.228.47.196` (bypass работает)

## Проверка безопасности

DNS не должен подменять обычные домены. Сравниваем резолв google.com, xbox.com через проверяемый DNS и Google DNS.

**Результат тестирования:**
- google.com: совпадает ✅
- xbox.com: совпадает ✅
- microsoft.com: разные IP, но оба в 13.107.x.x (Microsoft CDN) — норма

**Вывод:** Сравнивать по /16 подсети (первые 2 октета), не по точному IP. CDN-вариация — не подмена.

## dnspython API

```python
import dns.resolver
resolver = dns.resolver.Resolver()
resolver.nameservers = ['178.22.122.100']
resolver.lifetime = 5  # таймаут в секундах
result = resolver.resolve('xsts.auth.xboxlive.com', 'A')
for ip in result:
    print(ip)
```

## Статусы проверки

| Статус | Значение |
|--------|----------|
| working | Bypass работает (нестандартный IP) |
| not_working | Bypass не работает (стандартный Azure IP) |
| timeout | DNS не ответил за 5 сек |
| error | Ошибка резолва |
| unsafe | DNS подменяет обычные домены |
| unchecked | Не проверялся |

## Диапазоны Azure IP (Xbox Live)

Из netify.ai + реальных резолвов: 20.x.x.x, 40.x.x.x, 52.x.x.x — стандартные Microsoft Azure.
Всё остальное = bypass proxy.

## Ограничения

- Из GitHub Actions (US) DNS может отвечать иначе чем из РФ
- Таймаут 5 сек — достаточно, при проблемах ставим "timeout"
- Один DNS может работать с перебоями — нужны повторные проверки (v1.0)
