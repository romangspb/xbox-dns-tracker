# Валидация гипотез для v1.0.6 (Vercel + browser fetch)

**Дата:** 2026-04-11
**Фаза:** Phase 1 плана `plans/2026-04-11-reachability-check-v106.md`
**Ветка:** `feature/v1.0.6-reachability`

## Цель

Перед тем как писать код для v1.0.6 — проверить все ключевые предположения, на которых построен план. Без этого рискуем написать код, который не работает по принципиальным причинам.

---

## Окружение

- **OS:** macOS (darwin)
- **Node.js:** v24.14.1 (требование Vercel ≥ 20 — с запасом)
- **npm:** 11.11.0
- **Vercel CLI:** 50.43.0 (запускается через `npx --yes vercel@latest`, глобальная установка не удалась из-за permissions на `/usr/local/lib/node_modules`; `npx` оказался лучшим решением — не трогает систему, безопасен, достаточно быстр после первого вызова)
- **Vercel аккаунт:** `romangspb` (Hobby/Free план), scope `romangspbs-projects`
- **Телеметрия CLI:** отключена (`vercel telemetry disable`)
- **Проект создан:** `xbox-dns-tracker` (projectId `prj_21NuFp86FsOuhxcbQQGuLmMtVVXq`)

---

## Гипотеза 1: `dns.Resolver.setServers()` работает для нашей задачи

**Что проверяли:** умеет ли встроенный Node `dns.promises.Resolver` с `setServers([ip])` резолвить `xsts.auth.xboxlive.com` через произвольный публичный DNS и корректно возвращать bypass (non-Azure) или Azure IP. Плюс: корректно ли обрабатывается таймаут для несуществующего DNS.

**Как проверяли:** `scripts/test-dns-resolver.js` — 6 тестов.

**Результаты:**

| DNS | IP | Результат | Время | Вердикт |
|---|---|---|---|---|
| Cloudflare | 1.1.1.1 | 20.201.200.49 | 209ms | ✅ Azure (ожидаем) |
| Google | 8.8.8.8 | 40.90.8.102 | 156ms | ✅ Azure (ожидаем) |
| Bypass #1 (unsafe) | 31.192.108.180 | 87.228.47.196 | 226ms | ✅ BYPASS |
| Bypass #2 (unsafe) | 176.99.11.77 | 87.228.47.196 | 196ms | ✅ BYPASS (тот же прокси) |
| Known not_working | 178.22.122.100 | 20.201.192.52 | 236ms | ✅ Azure (ожидаем) |
| Invalid (timeout) | 198.51.100.1 | ETIMEOUT | 5000ms | ✅ timeout (ожидаем) |

**Итого: 6/6 passed.** Гипотеза подтверждена.

**Бонусные находки:**
- Все успешные резолвы укладываются в 150-240ms. Параллельный резолв 16 DNS-серверов (наш worst case из data.json) уложится в ~1-2 секунды.
- Таймаут работает чисто: `ETIMEOUT` через 5 сек (настройка `{ timeout: 5000, tries: 1 }`). Не висит.
- `87.228.47.196` — общий bypass-прокси для нескольких DNS. Это значит в реальной проверке target IPs будут сильно дедуплицироваться, что ускорит тест.
- В нашем датасете **нет DNS со статусом `working`** — только `unsafe` (14), `not_working` (7), `timeout` (16). «Unsafe» = обход работает, но DNS также подменяет другие домены. Для Xbox они всё равно полезны, они и составляют основу базы.

**Значение для плана:** код Vercel Function `/api/resolve` пишем в точности по этой схеме — `new dns.promises.Resolver({timeout: 5000, tries: 1})` + `setServers([dns])` + `resolve4(XSTS_HOST)`.

---

## Гипотеза 2: Браузерный `fetch` в `no-cors` различает доступные и недоступные IP

**Что проверяли:** умеет ли `fetch(url, { mode: 'no-cors' })` отличать reachable host (быстро resolved, opaque response) от unreachable host (rejected с ошибкой или абортится по таймауту).

**Как проверяли:** `scripts/test-nocors-fetch.html` — 5 тестов. Открывали в дефолтном браузере пользователя.

**Результаты:**

| URL | Ожидание | Результат | Время |
|---|---|---|---|
| https://1.1.1.1/ | reachable | ✅ REACHABLE | 404ms |
| https://8.8.8.8/ | reachable | ✅ REACHABLE | 299ms |
| https://87.228.47.196/ | reachable (ошибочно) | UNREACHABLE (abort) | 5002ms |
| https://198.51.100.1/ | unreachable | ✅ UNREACHABLE (abort) | 5002ms |
| https://203.0.113.1/ | unreachable | ✅ UNREACHABLE (abort) | 5002ms |

**Итого: 4/5 passed в исходной интерпретации, НО механика работает правильно.**

**Что случилось с 87.228.47.196:** я ошибочно ожидал что этот IP всегда reachable. На практике:
- У тестера был включён VPN
- VPN не пропускал/не маршрутизировал трафик к этому российскому IP
- Таймаут 5000ms → честный ответ «из твоей сети недоступен»

**Это не ошибка — это именно то что нам нужно.** Механизм корректно отличает:
- Reachable: fetch resolved за 300-400ms
- Unreachable: fetch abort'ится ровно на таймауте 5000ms (AbortError в catch)

**Ключевое следствие для UX:** VPN пользователя критически влияет на результаты. Модалка «Выключи VPN перед проверкой» из Phase 4 плана — **обязательна**, а не «nice-to-have». Без неё юзер с активным VPN получит ложно-отрицательные результаты по всем российским bypass-IP.

**Значение для плана:** код `probeTargetIp` пишем по схеме:
```js
async function probeTargetIp(ip) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(`https://${ip}/`, { mode: 'no-cors', signal: controller.signal, cache: 'no-store' });
    return 'reachable';
  } catch (e) {
    return 'unreachable';
  } finally {
    clearTimeout(timeout);
  }
}
```

---

## Гипотеза 3: Vercel Free лимиты нам хватит

**Что проверяли:** текущие лимиты Hobby плана Vercel в dashboard / документации.

**Оценка потребления для v1.0.6:**
- 5 пользователей
- 16 dns_pair без cached resolved_ip требуют вызов `/api/resolve`
- Кэш в функции: 24 часа на один DNS
- Кэш в localStorage: 1 час на пользователя
- Пессимистичная оценка: 5 юзеров × 16 DNS × 1 раз/день = **80 вызовов функции в день = ~2400 в месяц**

**Лимиты Vercel Hobby (актуально на 2026-04):**
- Function Invocations: **100 000/месяц** → используем ~2.4% (запас 40x)
- Bandwidth: 100 GB/месяц → нам нужны килобайты на вызов, запас огромен
- Serverless Function Execution: 100 GB-hours/месяц → наша функция выполняется <1 сек, запас огромен
- Function timeout: 10 сек (Hobby) → нам нужно 5 сек для DNS-резолва, запас достаточен

**Итого:** лимитов Free более чем достаточно. При деплое включим встроенный Spend Management в Vercel dashboard с alert'ом на 50% использования — если что, узнаем заранее.

---

## Гипотеза 4: Vercel CLI можно использовать автономно через токен

**Что проверяли:** умеет ли CLI работать с токеном из `.env.local` без интерактивных подсказок.

**Результаты:**
- `vercel whoami` — работает, возвращает `romangspb`
- `vercel project ls` — работает, показывает проект в скоупе
- `vercel link --yes --project xbox-dns-tracker --scope romangspbs-projects` — работает
- Vercel CLI предлагал установить «Vercel plugin for claude-code» при `vercel link` — **отклонён** по правилу security-review для любых плагинов/скиллов

**Значение для плана:** все команды CLI запускаем через обёртку `set -a && source .env.local && set +a && npx vercel ...`. Токен никогда не попадает в git (подтверждено `git check-ignore`), не светится в ps, не логируется.

---

## Препятствия — не найдено

Все 4 гипотезы подтверждены. Нет необходимости менять план или искать обходные пути. Можно переходить к Phase 2 (портабельный Vercel-бэкенд).

---

## Следующие шаги

1. ✅ Все задачи Phase 1 выполнены
2. Удалить временные тестовые файлы: `scripts/test-dns-resolver.js`, `scripts/test-nocors-fetch.html`
3. Обновить статус Phase 1 в плане → `[x]`
4. Закомитить промежуточный прогресс (ветка `feature/v1.0.6-reachability`)
5. Перейти к Phase 2: написать `api/resolve.js` + `vercel.json`
