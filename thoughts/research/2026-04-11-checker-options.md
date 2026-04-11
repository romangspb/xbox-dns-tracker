# Research: как реализовать «работает у тебя»-проверку для Xbox DNS Tracker

> **Стадия:** Stage 1 (Deep Research) per `bulletproof` skill.
> **Дата:** 2026-04-11
> **Контекст:** v1.0.6 пытался решить задачу через browser-side fetch — провалился из-за TLS-сертификатов на xsts proxies. Серверный probe — не решение, не отвечает на исходный вопрос. Нужен новый подход.
> **Не разрабатываем — собираем варианты, оцениваем, рекомендуем. Решение принимает Roman.**

---

## TL;DR (читать первым)

**Ключевая проблема:** xsts proxies — это небольшие сервера, которые отвечают на TCP/443 но НЕ имеют валидных публичных TLS-сертификатов для своих IP-адресов. Любая система, которая проверяет cert (Safari, iOS Shortcuts, NSURLSession, Chrome, всё что использует системный TLS-стек), не может завершить handshake → fetch падает → мы видим «недоступен» даже для рабочих IP. Только Xbox-консоль обрабатывает это иначе (custom protocol/lax validation).

**Поэтому никакое решение «через браузер» (включая PWA) не работает.** PWA на iOS — это та же Safari, те же ограничения. iOS Shortcuts тоже использует системный TLS-стек, тоже падает. Это подтверждено документацией Apple и сообществом разработчиков.

**Что МОЖЕТ работать:**

| Подход | Платформа | User effort | Dev effort | Cost | Решает основную проблему? |
|---|---|---|---|---|---|
| **Guided manual wizard** | iPhone, любой браузер | Medium (менять DNS вручную в Wi-Fi настройках, выключать Private Relay) | Low | Free | ⚠️ Частично — даёт «зелёный сигнал» через альтернативный механизм без TLS |
| **Native iOS app via TestFlight** | iPhone | Low (one-tap install) | High (Swift) | $99/year Apple Developer Program | ✅ Да — приложение делает raw TCP probe |
| **Native iOS app via AltStore/SideStore sideload** | iPhone | High (сложный install, weekly refresh) | High (Swift) | Free | ✅ Да |
| **Native macOS menu bar app (notarized)** | Mac | Low (download + open) | Medium (Swift) | $99/year | ✅ Да — для тех у кого Mac |
| **Native macOS menu bar app (unsigned)** | Mac | Medium (right-click → Open → bypass Gatekeeper) | Medium (Swift) | Free | ✅ Да — для тех у кого Mac |
| **Standalone Windows .exe (self-signed)** | Windows | Medium (SmartScreen warning) | Medium (.NET/Python+PyInstaller) | Free | ✅ Да |
| **Local Python script + browser UI on localhost** | Mac/Win/Linux | Medium (установить Python, запустить) | Low | Free | ✅ Да |
| **Multi-region server-side probe (Vercel + RU VPS)** | Сервер | Zero (для пользователя) | Low-medium | $2-3/мес RU VPS | ⚠️ Не «у конкретного пользователя», но «у пользователей в его регионе» — лучший пользовательский сигнал чем сейчас |
| **Crowdsourced статусы (v2.0)** | Сервер | Low (один тап) | Medium (бэкенд + БД) | Free на Vercel KV/Supabase | ⚠️ Не мгновенно, но даёт реальный сигнал «работает у других» |

**Моя рекомендация после ресёрча: ДВУХ-ЭТАПНЫЙ ГИБРИД**

1. **Сейчас (быстро, без $99/year):** *Guided manual wizard для iPhone* + *Multi-region server probe для всех* + *крошечный Mac/Win local probe для технических пользователей*
2. **Позже (если проект пойдёт):** *Native iOS app через TestFlight* как премиум-опыт

Подробности и обоснования — ниже. Roman принимает финальное решение какие из этих веток развивать.

---

## Карта вариантов с разделением по платформам

### iPhone — целевая платформа (друзья Roman'а)

#### 📱 Вариант 1: Guided Manual Wizard (моя рекомендация для iPhone)

**Идея:** Web-страница, которая ВЕДЁТ пользователя через ручной процесс смены DNS, а не пытается всё автоматизировать. Один цикл — один DNS.

**Как работает:**
1. Пользователь открывает сайт на iPhone
2. Тапает «Начать поиск рабочего DNS»
3. Сайт показывает первый DNS из приоритетного списка: «Сейчас попробуем `31.192.108.180`»
4. Сайт показывает пошаговую инструкцию (с скриншотами): «Выйди из браузера → Настройки → Wi-Fi → нажми (i) рядом с твоей сетью → Configure DNS → Manual → Add Server → введи 31.192.108.180 → Save → возвращайся сюда»
5. Пользователь возвращается на сайт, тапает «Я установил, проверь»
6. Сайт автоматически делает `fetch('https://xsts.auth.xboxlive.com/timeline-test')` с таймаутом 5 сек
7. **Магия в анализе результата:**
   - Если fetch успешен <800ms → DNS вернул Microsoft Azure IP (нет bypass) → «Этот DNS не обходит. Пробуем следующий.»
   - Если fetch падает с TLS error / network error → ВЕРОЯТНО bypass работает (DNS вернул кастомный proxy IP который не имеет валидного cert или не отвечает на нашу попытку) → «Этот DNS подменяет xsts на другой IP. **Попробуй на Xbox прямо сейчас, скажешь работает или нет.**»
   - Если fetch успешен >800ms — пограничный случай, возможно proxy с валидным certом, тоже стоит проверить на Xbox
8. После теста сайт спрашивает: «Сработало на Xbox?» → Yes/No → сохраняет в localStorage + (опционально) отправляет в краудсорс-базу
9. Если No → переходим к следующему DNS в приоритетном списке
10. Продолжаем пока не найдём рабочий

**Что нужно от пользователя один раз перед началом:**
- Открыть Settings → General → VPN, DNS & Device Management → Configurations → отключить **iCloud Private Relay** (если включён) — иначе iOS игнорирует ручной DNS
- Открыть Safari → Settings → Advanced → отключить **Advanced Tracking and Fingerprinting Protection** для нашего сайта (или просто выключить Private Browsing)
- Это однократно, не каждый раз

**Плюсы:**
- ✅ Никакого install, никаких приложений, никаких профилей
- ✅ Работает на iPhone (Wi-Fi only — но это основной кейс для геймеров с домашней сетью)
- ✅ Бесплатно, без Developer Program
- ✅ Использует существующий механизм iOS, мы только улучшаем UX
- ✅ Даёт пользователю **обучение**: после нескольких циклов он понимает как это работает
- ✅ Реальная проверка с реальной сети пользователя (DNS стоит у него системно, fetch идёт через эту сеть)
- ✅ Косвенно решает TLS-проблему — мы используем TLS error как СИГНАЛ что bypass работает

**Минусы:**
- ⚠️ Требует ручного действия пользователя на каждый цикл (~30 секунд на DNS)
- ⚠️ Только Wi-Fi (не работает в LTE/5G)
- ⚠️ Apple Private Relay должен быть выключен — пользователь должен один раз это сделать
- ⚠️ Эвристика «TLS error = bypass» не 100% точная (proxy с валидным cert будет ложно-отрицательной, медленный Microsoft будет ложно-положительной). Но порядок ошибок сильно отличается от случайного.
- ⚠️ Логика на сайте сложнее текущей mock-кнопки (но всё ещё в рамках браузерного JS)

**Dev effort:** Medium (1-2 дня). Большую часть UI можно переиспользовать из v1.0.6 (большая кнопка, прогресс, метки на карточках).

**Решает ли исходный вопрос?** Да, частично. Пользователь получает реальный сигнал на основе РЕАЛЬНОЙ резолюции через свой канал. Не такой 100%-точный как native, но СИЛЬНО лучше «вакуумной серверной проверки».

---

#### 📱 Вариант 2: Native iOS app через TestFlight

**Идея:** Маленькое нативное iOS-приложение, которое делает raw TCP probe на 443 порт всех target IPs прямо из сети пользователя. Распространяется через TestFlight (link → tap → install).

**Как работает:**
1. Roman регистрируется в Apple Developer Program ($99/год)
2. Пишет приложение на Swift (~200-500 строк): SwiftUI экран с кнопкой и списком, под капотом `URLSession` + `Network.framework` для TCP-проверок
3. Загружает в TestFlight, добавляет до 10000 testers через email/link
4. Отправляет друзьям TestFlight-ссылку
5. Друзья ставят TestFlight (один раз) → переходят по ссылке → ставят наше приложение
6. Открывают, тапают «Test all» — приложение пробует TCP connect ко всем 56 target IPs из своей сети
7. Показывает зелёные/красные метки

**Плюсы:**
- ✅ **Самое настоящее «работает у тебя»** — приложение РЕАЛЬНО находится в сети пользователя
- ✅ Может делать `Network.framework` raw TCP — обходит ВСЕ TLS-проблемы
- ✅ Может работать в LTE/5G (не только Wi-Fi)
- ✅ One-tap install через TestFlight
- ✅ Может быть в фоне, обновлять данные, показывать notification
- ✅ Можно сделать share extension: "поделиться этим IP в наше приложение → сразу проверка"

**Минусы:**
- ❌ **$99/год Apple Developer Program** — единственный значимый минус
- ⚠️ TestFlight builds истекают через 90 дней — нужно регулярно перезаливать
- ⚠️ Roman должен освоить Swift / Xcode (или нанять)
- ⚠️ Distribution через TestFlight требует каждого user'а на отдельный screen Apple TestFlight приложения — небольшая, но не нулевая friction

**Dev effort:** High (2-5 дней для базовой версии, если Swift не знаком). Существенная одноразовая инвестиция.

**Решает ли исходный вопрос?** Идеально. Это «правильный» способ.

---

#### 📱 Вариант 3: Native iOS app через AltStore / SideStore (sideload)

**Идея:** Тот же native iOS app, но без $99/год — распространяется через бесплатный AltStore.

**Как работает:**
- Пользователь устанавливает AltStore (требует Mac или Windows для генерации сертификата)
- Через AltStore ставит наш .ipa файл
- Каждые 7 дней приложение «истекает» и нужно refresh через AltStore

**Плюсы:**
- ✅ Бесплатно
- ✅ Все возможности нативного приложения

**Минусы:**
- ❌ **Очень технический install** — AltStore + Mac/PC + Apple ID + сложная процедура
- ❌ **Refresh каждые 7 дней** — приложение умирает если пользователь забыл
- ❌ Совершенно не подходит для casual friends Roman'а
- ❌ В iOS 18+ Apple усложнил sideload в РФ

**Dev effort:** High (тот же что для TestFlight) + поддержка пользователей с install.

**Вывод:** Технически работает, но UX неприемлем для целевой аудитории.

---

#### 📱 Вариант 4: PWA «Add to Home Screen» — НЕ РАБОТАЕТ ❌

PWA на iOS — это та же Safari с иконкой на экране. Те же ограничения fetch, те же TLS-проблемы. **Не решает задачу.** Можно использовать как обёртку для Guided Manual Wizard (Вариант 1) — придаёт ощущение «приложения» без реального решения.

---

#### 📱 Вариант 5: iOS Shortcut с iCloud-link distribution — НЕ РАБОТАЕТ ❌

Идея была хорошая (one-tap install, нет AppStore), но **подтверждено в Apple docs**: iOS Shortcuts валидирует TLS строго через системный стек. Никакого workaround в самом Shortcut нет. Даже Run JavaScript on Webpage запускается в Safari context — те же ограничения. **Не решает задачу.**

---

#### 📱 Вариант 6: Custom CA certificate trust + наш own MITM — НЕ ПОДХОДИТ ❌

Идея: установить пользователю профиль с нашим custom Root CA, потом перехватить трафик к xsts proxies и подсунуть свой cert. Технически возможно, но требует от нас контроля над xsts proxies (мы их не контролируем — они принадлежат третьим сторонам). **Не реализуемо.**

---

### macOS / Windows — для пользователей с ноутбуками

#### 💻 Вариант 7: Native macOS menu bar app (unsigned)

**Идея:** Маленькое Swift-приложение в menu bar. Пользователь скачивает .app файл, открывает (правый клик → Открыть для обхода Gatekeeper), видит результаты.

**Как работает:**
1. Roman пишет SwiftUI menu bar app (~200 строк): берёт data.json с нашего сайта, делает TCP-probe всех IPs через Network.framework, показывает результаты в окне
2. Архивирует в .app
3. Размещает на сайте/в Telegram канале как .zip
4. Друг скачивает, распаковывает, **правый клик на .app → Открыть → Gatekeeper warning → Открыть всё равно**
5. Приложение работает

**Плюсы:**
- ✅ Бесплатно (без Developer Program)
- ✅ Native — настоящий доступ к сети
- ✅ Стабильная install — один раз скачал, работает навсегда
- ✅ Открывает дорогу к notifications, background updates, shortcuts

**Минусы:**
- ⚠️ Только Mac (часть друзей могут быть на Windows/Linux)
- ⚠️ Gatekeeper warning при первом открытии — небольшая, но реальная friction
- ⚠️ Roman должен освоить SwiftUI / Xcode (но проще чем iOS — нет provisioning profiles)

**Dev effort:** Medium (1-2 дня).

#### 💻 Вариант 8: Native macOS menu bar app (notarized) — то же что #7 но за $99/год

То же приложение, но залито в Apple Notarization. Открывается без warning'ов. Стоит $99/год. Если Roman всё равно платит $99 для iOS (Вариант 2), notarization идёт «бесплатно» (тот же developer account).

#### 💻 Вариант 9: Standalone Windows .exe (self-signed)

**Идея:** То же что macOS, но для Windows. Пишем на .NET / C# / Python+PyInstaller.

**Как работает:**
1. Маленькое Windows-приложение (WinForms, Avalonia, или Electron — на вкус). Лично я бы взял **Tauri** (Rust + Web UI) — лёгкий бинарь ~5MB, кросс-платформенный.
2. Self-signed certificate via PowerShell `New-SelfSignedCertificate`
3. Подписываем .exe через signtool
4. Распространяем как .zip или standalone .exe
5. Пользователь скачивает, запускает, видит SmartScreen warning «Unknown publisher» → «Run anyway»
6. Работает

**Плюсы:**
- ✅ Бесплатно
- ✅ Native TCP, обходит TLS-проблему
- ✅ Один файл, одно скачивание

**Минусы:**
- ⚠️ SmartScreen warning при первом запуске
- ⚠️ Roman должен освоить выбранный фреймворк
- ⚠️ Большая часть друзей на iPhone, не на Windows — может быть малая аудитория

**Dev effort:** Medium-High в зависимости от стека (если Tauri/Avalonia — быстрее).

#### 💻 Вариант 10: Python script + local web server (Mac/Win/Linux)

**Идея:** Python-скрипт делает TCP-проверку, поднимает локальный HTTP-сервер на `127.0.0.1:8765`, открывает в браузере страницу с результатами.

**Как работает:**
1. Roman пишет `xbox_check.py` (~50 строк): берёт data.json через requests, делает TCP-probe через socket, поднимает Flask/aiohttp server
2. Distribution: либо как .py файл (требует Python установлен), либо PyInstaller-binary (один файл, ~10MB)
3. Friend скачивает, запускает, в браузере открывается localhost:8765 с результатами

**Плюсы:**
- ✅ Кросс-платформенно одним кодом (Mac/Win/Linux)
- ✅ Бесплатно
- ✅ Можно использовать наш существующий Python `checker.py` напрямую — минимум нового кода
- ✅ Native TCP, обходит TLS

**Минусы:**
- ⚠️ Если .py — нужно установить Python, не для casual users
- ⚠️ Если PyInstaller binary — Mac снова требует Gatekeeper bypass, Windows SmartScreen warning
- ⚠️ Браузер должен открыться сам после запуска (`webbrowser.open('http://localhost:8765')`)

**Dev effort:** Low (полдня — в основном переиспользуем checker.py).

---

### Универсальные / серверные подходы

#### 🌐 Вариант 11: Multi-region server-side probe + RU VPS

**Идея:** Расширяем существующий checker.py, чтобы он запускался из РАЗНЫХ географических точек, не только из GitHub Actions (US). Дополнительно — крошечный VPS в России для probe из РФ.

**Как работает:**
1. Запускаем checker.py из 3-4 точек: GH Actions (US), Vercel function в Frankfurt, **Vercel function в Stockholm (arn1) — ближайшая к РФ**, и **Russian VPS (~150₽/мес от Timeweb или Selectel)**
2. Каждая точка пишет результаты в общий data.json (через GitHub merge или Vercel KV)
3. На карточке DNS показываем не один статус, а 4: «🇺🇸 ✓ | 🇪🇺 ✓ | 🇷🇺 ✗ | 🇸🇪 ✗»
4. Пользователь видит «работает в Швеции, не работает в РФ» — это уже даёт реальный сигнал (для русских пользователей)

**Плюсы:**
- ✅ Никаких действий от пользователя — всё работает само
- ✅ Кросс-платформенно (это серверная фича)
- ✅ Близко к «реальной сети пользователя» — Russian VPS показывает примерно ту же сеть что и его ISP
- ✅ Дешёво (~$2-3/месяц)
- ✅ Использует существующий checker.py с минимальными изменениями
- ✅ Хорошо комбинируется с любым из вариантов выше

**Минусы:**
- ⚠️ Не САМЫЙ конкретный пользователь — это «средний российский ISP», а не его лично
- ⚠️ Регулярные платежи за VPS (мелочь, но навсегда)
- ⚠️ Russian VPS — серверу нужны public IP, регистрация владельца, и т.д. (хотя для тестирующего сервера это не проблема)

**Dev effort:** Low-Medium (1-2 дня — настройка VPS, простой Python-демон, sync результатов).

**Решает ли исходный вопрос?** Не идеально, но **сильно лучше** текущей ситуации. Дополняет любой клиентский вариант.

#### 🌐 Вариант 12: Crowdsourced статусы (v2.0 черновик)

Уже есть в плане v2.0. Идея: пользователи отмечают «работает / не работает», агрегируем с time-decay фильтром. Сервер.

**Решает ли исходный вопрос?** Только постепенно — нужна критическая масса пользователей чтобы данные стали полезными. Roman сейчас имеет 5 друзей-тестеров — недостаточно для статистики.

**Хорошо комбинируется** с любым клиентским вариантом — каждая попытка пользователя становится сигналом для других.

#### 🌐 Вариант 13: Tailscale / WireGuard relay через устройство пользователя — НЕ ПОДХОДИТ ❌

Идея: пользователь устанавливает Tailscale, мы становимся узлом в его mesh, наш сервер делает probe «как будто он у пользователя в сети». Технически возможно. Практически — gigantic UX overhead, требует от каждого пользователя установить и настроить mesh VPN. **Не для casual users.**

---

## Сравнение по критериям

| Критерий | Variant 1 (Manual Wizard) | Variant 2 (TestFlight) | Variant 7 (macOS unsigned) | Variant 9 (Windows .exe) | Variant 10 (Python script) | Variant 11 (Multi-region) |
|---|---|---|---|---|---|---|
| Платформа | iPhone | iPhone | Mac | Windows | Mac/Win/Linux | Все (server-side) |
| User effort first time | Medium (один раз настроить Private Relay) | Low (TestFlight install) | Medium (Gatekeeper bypass) | Medium (SmartScreen) | Medium (run script) | Zero |
| User effort each check | Medium (менять DNS вручную) | Low (one tap) | Low | Low | Low | Zero |
| Dev cost (one-time) | Medium (1-2 дня UI) | High (2-5 дней + Swift learning) | Medium (1-2 дня + Swift) | Medium (1-2 дня) | Low (полдня) | Low-Medium (1-2 дня) |
| Dev cost (recurring) | None | $99/год + перезалив TestFlight каждые 90 дней | None | None | None | $2-3/мес VPS |
| Reliability of result | Medium (heuristic) | High (raw TCP) | High | High | High | Medium-High (приближение к user network) |
| Casual user friendly? | Medium | High | Medium | Medium | Low | High (никаких действий) |
| Покрытие | Wi-Fi only | All | Mac only | Win only | Mac/Win/Linux | All users |

---

## Моя рекомендация после анализа

### Этап 1 — что делать прямо сейчас (без $99/год, минимум разработки)

**Реализовать Вариант 1 (Guided Manual Wizard) для iPhone + Вариант 11 (Multi-region probe) для всех.**

**Почему именно эта пара:**
1. **Variant 1** даёт настоящий сигнал «работает у тебя» через гениальное использование TLS error как индикатора bypass — без install, без $99/год, на основной целевой платформе
2. **Variant 11** даёт пассивный «региональный» сигнал для всех пользователей включая тех кто не хочет возиться с ручной настройкой DNS
3. Обе вместе дают пользователю две независимых линии сигналов — сильно лучше чем сейчас
4. Обе могут быть реализованы за 3-5 дней работы Roman'а
5. Существующий код v1.0.6 (большая кнопка, метки, фильтры) под флагом — подойдёт почти как есть, нужно только заменить логику в `runFullCheck`
6. Variant 11 переиспользует существующий `checker.py` — масштабирование известного решения

**В чём риски этого подхода:**
- Variant 1 эвристика может ошибиться: медленный Microsoft Azure → ложно-положительный bypass; быстрый proxy с валидным cert → ложно-отрицательный. Нужны калибровочные тесты.
- Variant 1 требует от пользователя выключить Apple Private Relay, что для некоторых ощущается как «странная просьба».
- Variant 11 RU VPS — небольшая инвестиция времени на настройку и регулярные платежи.

### Этап 2 — если проект пойдёт и захочется «премиум»

**Вариант 2 (Native iOS app via TestFlight)** — если пользовательская база растёт, инвестиция $99/год оправдана. Дает идеальное «работает у тебя».

Параллельно — **Вариант 7 (macOS unsigned menu bar app)** для тех друзей у которых есть Mac. Один раз написать, бесплатно распространять.

### Что НЕ делать

- ❌ Не пытаться возродить v1.0.6 reachability checker через browser fetch — фундаментально не работает
- ❌ Не делать iOS Shortcut — те же TLS-ограничения что и у Safari
- ❌ Не делать PWA как «решение» — это всё та же Safari
- ❌ Не делать Tailscale-relay — UX слишком тяжёлый для casual users
- ❌ Не реализовывать AltStore sideload путь — refresh каждые 7 дней не подходит для целевой аудитории

---

## Открытые вопросы для Roman'а

Когда он вернётся, спросить:

1. **Готов ли инвестировать $99/год Apple Developer Program?**
   - Если да — открывается путь к Variant 2 (native iOS) и заодно Variant 8 (notarized macOS)
   - Если нет — идём по Variant 1 + Variant 7/9/10 для desktop

2. **Сколько друзей на каждой платформе?**
   - 5 на iPhone? Тогда iPhone — главный, остальное — bonus
   - Кто-то на Mac? → стоит делать Variant 7
   - Кто-то на Windows? → стоит делать Variant 9 или Variant 10

3. **Готов разбираться со Swift / другим стеком?** Или предпочитает Python (Variant 10)?

4. **Готов настроить и поддерживать RU VPS?** Это сильно улучшает данные для всех пользователей, но навсегда +$2-3/мес и небольшая поддержка.

5. **Эвристика «TLS error = bypass» — приемлема ли как «лучшее доступное» для Variant 1?** Мы можем добавить честный disclaimer «у нас нет 100% теста, но есть сильное приближение». Roman должен решить уровень допустимой неточности.

---

## Sources

- [iOS Shortcuts: Get Contents of URL — SSL strict validation](https://developer.apple.com/forums/thread/655074)
- [Apple Developer Program: distribution methods 2026](https://foresightmobile.com/blog/ios-app-distribution-guide-2026)
- [iOS DNS Settings device management payload (DoH/DoT only)](https://developer.apple.com/documentation/devicemanagement/dnssettings)
- [iPhone manual DNS change in Wi-Fi settings](https://www.macinstruct.com/tutorials/how-to-change-your-iphones-dns-servers/)
- [Apple Private Relay bypasses manual DNS](https://discussions.apple.com/thread/255172210)
- [PWA iOS limitations (TLS, fetch, service workers)](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [WebRTC and Direct Sockets API — no raw TCP from browser](https://github.com/WICG/direct-sockets/blob/main/docs/explainer.md)
- [Distributing macOS apps outside App Store](https://www.appcoda.com/distribute-macos-apps/)
- [Sign Windows .exe with self-signed certificate via PowerShell](https://gist.github.com/PaulCreusy/7fade8d5a8026f2228a97d31343b335e)
- [iCloud link sharing for iOS Shortcuts](https://support.apple.com/guide/shortcuts/share-shortcuts-apdf01f8c054/ios)
- [iOS configuration profile installation flow](https://developers.cloudflare.com/1.1.1.1/setup/ios/)
- [Trust manually installed certificate profiles](https://support.apple.com/en-us/102390)
- [Run JavaScript on Webpage in Shortcuts (Safari context)](https://support.apple.com/guide/shortcuts/use-the-run-javascript-on-webpage-action-apdb71a01d93/ios)
- [Chrome Local Network Access (LNA) restrictions 2025+](https://developer.chrome.com/blog/local-network-access)

---

## Что НЕ исследовано (если Roman попросит копать дальше)

- **Calibration of TLS-error heuristic for Variant 1**: нужны реальные measurements на 30+ DNS из data.json чтобы подтвердить precision/recall эвристики «TLS error = bypass works». Может оказаться что точность 70% или 95% — это решит судьбу Варианта 1.
- **Detailed cost/setup of Russian VPS**: сравнение Timeweb / Selectel / beget по цене, требованиям к регистрации, поддержке Python.
- **Tauri vs Electron vs Avalonia** для Variant 9 — какой лучше для casual users on Windows.
- **Альтернативные подходы к probing IP-сервера БЕЗ TLS handshake**: возможно есть exotic browser API через Beacon, sendBeacon, fetch keepalive, image preload с timeout etc. — я перечислил основные но мог пропустить какой-то edge case.
- **Mobile data в сетке vs Wi-Fi** для Variant 1 — iOS не позволяет менять DNS в LTE/5G через Settings, но можно через VPN profile (обычный VPN, не privacy VPN). Стоит ли заморачиваться?
- **iOS App Clip** — миниатюрные iOS-приложения которые можно открыть через QR/link без полной установки. Но они тоже требуют Developer Program и имеют ограничения.

---

## Финальный комментарий

Этот ресёрч показывает: **«работает у тебя»-проверка для Xbox bypass DNS — это не тривиальная задача, и универсального решения «через браузер» не существует**. Каждый из 13 рассмотренных вариантов имеет компромиссы. Решение зависит от того, какие компромиссы Roman готов принять (deniyalty / dev effort / cost / coverage / accuracy).

Самое лучшее **техническое** решение — Native iOS app via TestFlight (Variant 2). Самое лучшее **бесплатное** решение — Guided Manual Wizard + Multi-region server (Variants 1 + 11).

Готов детализировать любой из этих вариантов в полноценный план реализации, как только Roman выберет направление.
