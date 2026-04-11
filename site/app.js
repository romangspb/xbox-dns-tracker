// Xbox DNS Tracker — app.js

const USERS = ['Fiprok', 'xromep', 'mph88mcfl', 'Musl99', 'siluyanchik'];
const STATUS_CYCLE = ['untried', 'works', 'not-works'];

const CHECK_STATUS_LABELS = {
  working: 'Работает',
  not_working: 'Не обходит',
  unsafe: 'Небезопасен',
  timeout: 'Не отвечает',
  error: 'Ошибка',
  unchecked: 'Не проверен',
  reachable: 'Доступен',
  unreachable: 'Недоступен',
  ipv6_unchecked: 'IPv6',
};

const CHECK_STATUS_HINTS = {
  working: 'DNS обходит блокировку Xbox. Проверено автоматически через резолв xsts.auth.xboxlive.com.',
  not_working: 'DNS не обходит блокировку — возвращает стандартный IP Microsoft Azure.',
  unsafe: 'DNS обходит блокировку, но подменяет обычные сайты (google.com). Может перехватывать трафик.',
  timeout: 'Сервер не ответил за 5 секунд. Может быть недоступен из вашего региона.',
  error: 'Произошла ошибка при проверке.',
  unchecked: 'Ещё не проходил автоматическую проверку.',
  reachable: 'Прокси-сервер доступен на порту 443. Скорее всего работает для подмены на роутере.',
  unreachable: 'Прокси-сервер не отвечает. Скорее всего не работает.',
  ipv6_unchecked: 'IPv6 DNS не проверяется автоматически (ограничение GitHub Actions). Попробуй — скорее всего работает, если у тебя IPv6-интернет.',
};

const DIFFICULTY_LABELS = {
  easy: 'Для прописывания в Xbox',
  medium: 'Настройка на роутере',
  hard: 'Продвинутый способ',
};

const DIFFICULTY_ORDER = ['easy', 'medium', 'hard'];

// Фильтры
let filterType = 'dns_v4';            // 'dns_v4' | 'dns_v6' | 'xsts'
let filterStatuses = new Set(['all']); // мульти-выбор: Set of statuses или 'all'
let filterReachable = false;          // показывать только reachable (Phase 4)

// === v1.0.6: reachability check ===
// MVP: фича выключена через флаг. Browser-side fetch не работает для xsts proxies
// (TLS handshake падает на самоподписанных/некорректных сертификатах).
// Серверный probe = бесполезное дублирование checker.py (та же сеть Vercel ~ GH Actions,
// нет «реальной сети пользователя»). Решение пользователя 2026-04-11: убрать с фронта,
// весь код оставить под флагом, искать новый подход (см. v1.0.6 plan: research phase).
// Чтобы вернуть — поставь true, всё снова появится.
const REACH_CHECK_ENABLED = false;

// reachabilityResults: { methodId: 'reachable' | 'unreachable' | 'unknown' } или null
let reachabilityResults = null;
let lastCheckAt = null;
let lastResolveFailures = 0;     // сколько DNS не удалось разрешить через /api/resolve
let lastIpv6Skipped = 0;         // сколько IPv6 пропущено
let checkInProgress = false;
const REACH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 час
const PROBE_TIMEOUT_MS = 5000;
const RESOLVE_API = '/api/resolve';

// --- Хранилище ---

function getCurrentUser() {
  return localStorage.getItem('xbox_user');
}

function setCurrentUser(name) {
  localStorage.setItem('xbox_user', name);
}

function getUserStatuses() {
  try {
    return JSON.parse(localStorage.getItem('xbox_statuses') || '{}');
  } catch {
    return {};
  }
}

function setUserStatus(methodId, userName, status) {
  const all = getUserStatuses();
  if (!all[methodId]) all[methodId] = {};
  all[methodId][userName] = status;
  localStorage.setItem('xbox_statuses', JSON.stringify(all));
}

// --- Определение IPv4/IPv6 ---

function isIPv6(ip) {
  return ip && ip.includes(':');
}

function getMethodIPVersion(method) {
  if (method.type !== 'dns_pair') return null;
  return isIPv6(method.primary_dns) ? 'v6' : 'v4';
}

// --- Модальные окна ---

// Блокировка скролла body пока открыта модалка — решает iOS баг
// «первое касание мимо контента в модалке начинает скроллить фон»
function lockBodyScroll() {
  document.body.style.overflow = 'hidden';
  document.body.style.touchAction = 'none';
}

function unlockBodyScroll() {
  document.body.style.overflow = '';
  document.body.style.touchAction = '';
}

// Универсальный helper: закрыть модалку и разблокировать скролл
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('active');
  unlockBodyScroll();
}

// Закрытие модалки по клику на overlay (но не на content)
function bindOverlayClose(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.addEventListener('click', (e) => {
    // Закрываем только если клик был в сам overlay, а не в его содержимое
    if (e.target === modal) {
      closeModal(modalId);
    }
  });
}

function showUserPicker() {
  const modal = document.getElementById('user-modal');
  const picker = document.getElementById('user-picker');
  picker.innerHTML = '';
  USERS.forEach(name => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.onclick = () => {
      setCurrentUser(name);
      modal.classList.remove('active');
      unlockBodyScroll();
      renderAll();
    };
    picker.appendChild(btn);
  });
  modal.classList.add('active');
  lockBodyScroll();
}

function showHelp() {
  document.getElementById('help-modal').classList.add('active');
  lockBodyScroll();
}

function showStatusPopup(status, el, e) {
  if (e) e.stopPropagation();

  const popup = document.getElementById('status-popup');
  const content = document.getElementById('status-popup-content');
  const hint = CHECK_STATUS_HINTS[status] || '';
  const label = CHECK_STATUS_LABELS[status] || status;

  content.innerHTML = `<strong>${label}</strong><br>${hint}`;

  // Позиционирование около элемента
  const rect = el.getBoundingClientRect();
  popup.style.top = (rect.bottom + 8) + 'px';
  popup.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - 280)) + 'px';
  popup.classList.add('active');

  // Убираем старый listener если был
  document.removeEventListener('click', hideStatusPopup);
  // Скрыть по тапу куда угодно
  setTimeout(() => {
    document.addEventListener('click', hideStatusPopup, { once: true });
  }, 10);
}

function hideStatusPopup() {
  document.getElementById('status-popup').classList.remove('active');
}

// --- Копирование DNS ---

function copyDNS(text, el) {
  const blob = new Blob([text], { type: 'text/plain' });
  const item = new ClipboardItem({ 'text/plain': blob });
  navigator.clipboard.write([item]).then(() => {
    const original = el.innerHTML;
    el.innerHTML = '<span class="copy-icon">✓</span> Скопировано';
    el.classList.add('copied');
    setTimeout(() => {
      el.innerHTML = original;
      el.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    prompt('Скопируйте DNS:', text);
  });
}

// --- Фильтры ---

function setTypeFilter(type) {
  filterType = type;
  filterStatuses = new Set(['all']);
  renderAll();
}

function toggleStatusFilter(status) {
  if (status === 'all') {
    filterStatuses = new Set(['all']);
  } else {
    filterStatuses.delete('all');
    if (filterStatuses.has(status)) {
      filterStatuses.delete(status);
    } else {
      filterStatuses.add(status);
    }
    if (filterStatuses.size === 0) {
      filterStatuses = new Set(['all']);
    }
  }
  renderAll();
}

function renderFilters() {
  const container = document.getElementById('filters');
  if (!appData) return;

  const methods = appData.methods.filter(m => m.active !== false);
  const dnsV4 = methods.filter(m => m.type === 'dns_pair' && !isIPv6(m.primary_dns)).length;
  const dnsV6 = methods.filter(m => m.type === 'dns_pair' && isIPv6(m.primary_dns)).length;
  const xstsCount = methods.filter(m => m.type === 'xsts_ip').length;

  // Методы текущего типа для подсчёта статусов
  let typed;
  if (filterType === 'dns_v4') {
    typed = methods.filter(m => m.type === 'dns_pair' && !isIPv6(m.primary_dns));
  } else if (filterType === 'dns_v6') {
    typed = methods.filter(m => m.type === 'dns_pair' && isIPv6(m.primary_dns));
  } else {
    typed = methods.filter(m => m.type === 'xsts_ip');
  }

  const statusCounts = {};
  typed.forEach(m => {
    const s = m.dns_check?.status || 'unchecked';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  // Фильтр по типу
  let typeHtml = `
    <div class="filter-group">
      <button class="filter-btn ${filterType === 'dns_v4' ? 'active' : ''}" onclick="setTypeFilter('dns_v4')">
        DNS IPv4 <span class="filter-count">${dnsV4}</span>
      </button>`;

  if (dnsV6 > 0) {
    typeHtml += `
      <button class="filter-btn ${filterType === 'dns_v6' ? 'active' : ''}" onclick="setTypeFilter('dns_v6')">
        DNS IPv6 <span class="filter-count">${dnsV6}</span>
      </button>`;
  }

  typeHtml += `
      <button class="filter-btn ${filterType === 'xsts' ? 'active' : ''}" onclick="setTypeFilter('xsts')">
        xsts IP <span class="filter-count">${xstsCount}</span>
      </button>
    </div>`;

  // Фильтр по статусу
  let statusHtml = '';
  {
    const statusOptions = filterType === 'xsts' ? [
      { key: 'all', label: 'Все' },
      { key: 'reachable', label: 'Доступен' },
      { key: 'timeout', label: 'Не отвечает' },
      { key: 'unreachable', label: 'Недоступен' },
    ] : filterType === 'dns_v6' ? [
      { key: 'all', label: 'Все' },
      { key: 'ipv6_unchecked', label: 'IPv6 (не проверяется)' },
    ] : [
      { key: 'all', label: 'Все' },
      { key: 'working', label: 'Работает' },
      { key: 'timeout', label: 'Не отвечает' },
      { key: 'unsafe', label: 'Небезопасен' },
      { key: 'not_working', label: 'Не обходит' },
      { key: 'unchecked', label: 'Не проверен' },
    ];

    let statusBtns = statusOptions
      .filter(o => o.key === 'all' || statusCounts[o.key])
      .map(o => {
        const cnt = o.key === 'all' ? typed.length : (statusCounts[o.key] || 0);
        const active = filterStatuses.has(o.key) ? ' active' : '';
        return `<button class="status-filter-btn${active}" onclick="toggleStatusFilter('${o.key}')">${o.label} <span class="filter-count">${cnt}</span></button>`;
      }).join('');

    // v1.0.6: фильтр «только доступные» — виден только после первой проверки (выключен через флаг)
    if (REACH_CHECK_ENABLED && reachabilityResults) {
      const reachableInType = typed.filter(m => reachabilityResults[m.id] === 'reachable').length;
      const active = filterReachable ? ' active' : '';
      statusBtns += `<button class="status-filter-btn${active}" onclick="toggleReachableFilter()">✓ Доступные <span class="filter-count">${reachableInType}</span></button>`;
    }

    statusHtml = `<div class="status-filters">${statusBtns}</div>`;
  }

  container.innerHTML = typeHtml + statusHtml;
}

// --- Рендер ---

let appData = null;

function renderAll() {
  if (!appData) return;
  const container = document.getElementById('methods-container');
  const user = getCurrentUser();

  // Время обновления
  const updatedEl = document.getElementById('updated-at');
  const date = new Date(appData.updated_at);
  updatedEl.textContent = 'Обновлено: ' + date.toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });

  renderFilters();
  if (REACH_CHECK_ENABLED) renderReachabilityResult();

  // Фильтрация
  let methods;
  if (filterType === 'dns_v4') {
    methods = appData.methods.filter(m => m.active !== false && m.type === 'dns_pair' && !isIPv6(m.primary_dns));
  } else if (filterType === 'dns_v6') {
    methods = appData.methods.filter(m => m.active !== false && m.type === 'dns_pair' && isIPv6(m.primary_dns));
  } else {
    methods = appData.methods.filter(m => m.active !== false && m.type === 'xsts_ip');
  }

  // Фильтр по статусу
  if (!filterStatuses.has('all')) {
    methods = methods.filter(m => filterStatuses.has(m.dns_check?.status || 'unchecked'));
  }

  // v1.0.6: фильтр «только доступные» (по результатам проверки доступа, выключен через флаг)
  if (REACH_CHECK_ENABLED && filterReachable && reachabilityResults) {
    methods = methods.filter(m => reachabilityResults[m.id] === 'reachable');
  }

  // Сортировка
  methods.sort((a, b) => {
    const aW = a.dns_check?.status === 'working' ? 0 : 1;
    const bW = b.dns_check?.status === 'working' ? 0 : 1;
    if (aW !== bW) return aW - bW;
    return (b.sources?.length || 0) - (a.sources?.length || 0);
  });

  container.innerHTML = '';

  if (!methods.length) {
    container.innerHTML = '<div class="empty-state">Нет DNS с таким статусом</div>';
    return;
  }

  // Инструкция
  const hint = document.createElement('div');
  hint.className = 'instruction';
  if (filterType === 'dns_v4') {
    hint.innerHTML = 'Нажми на IP чтобы скопировать → <strong>Настройки Xbox</strong> → Сеть → Дополнительные → DNS (вручную)';
  } else if (filterType === 'dns_v6') {
    hint.innerHTML = 'Пробуй только если IPv4 не помогли и твой интернет поддерживает IPv6. Эти DNS не проверяются автоматически — подставляй и смотри.';
  } else {
    hint.innerHTML = 'IP для подмены <strong>xsts.auth.xboxlive.com</strong> на роутере. Статус проверки не применим — это целевые IP, а не DNS-серверы.';
  }
  container.appendChild(hint);

  // Группировка по сложности (для dns), плоский список для xsts
  if (filterType !== 'xsts') {
    const grouped = {};
    DIFFICULTY_ORDER.forEach(d => grouped[d] = []);
    methods.forEach(m => {
      const d = m.difficulty || 'easy';
      if (grouped[d]) grouped[d].push(m);
      else grouped.easy.push(m);
    });

    DIFFICULTY_ORDER.forEach(diff => {
      const list = grouped[diff];
      if (!list.length) return;

      const section = document.createElement('div');
      section.className = 'difficulty-section';
      section.innerHTML = `
        <div class="difficulty-header">
          <span class="difficulty-badge ${diff}">${DIFFICULTY_LABELS[diff]}</span>
          <span class="difficulty-count">${list.length}</span>
        </div>
      `;
      list.forEach(m => section.appendChild(renderCard(m, user)));
      container.appendChild(section);
    });
  } else {
    methods.forEach(m => container.appendChild(renderCard(m, user)));
  }
}

function renderCard(method, currentUser) {
  const card = document.createElement('div');
  const diff = method.difficulty || 'easy';
  card.className = `dns-card ${diff}`;

  const isXsts = method.type === 'xsts_ip';
  const checkStatus = method.dns_check?.status || 'unchecked';
  const statusLabel = CHECK_STATUS_LABELS[checkStatus] || checkStatus;
  const sourceCount = method.sources?.length || 0;
  const isRecommended = (!isXsts && checkStatus === 'working' && sourceCount >= 2)
    || (isXsts && checkStatus === 'reachable' && sourceCount >= 2);

  // Статус-бейдж (кликабельный)
  let statusHtml = `<span class="dns-status ${checkStatus}" onclick="showStatusPopup('${checkStatus}', this, event)">${statusLabel}</span>`;

  // v1.0.6: метка доступности из реальной сети пользователя (выключена через флаг)
  let reachMarkHtml = '';
  if (REACH_CHECK_ENABLED && reachabilityResults) {
    const r = reachabilityResults[method.id];
    if (r === 'reachable') {
      reachMarkHtml = '<span class="reach-mark reach-ok" title="Вероятно сработает из твоей сети — попробуй на Xbox">✓</span>';
    } else if (r === 'unreachable') {
      reachMarkHtml = '<span class="reach-mark reach-fail" title="Точно не сработает из твоей сети">✗</span>';
    } else if (r === 'unknown') {
      reachMarkHtml = '<span class="reach-mark reach-unknown" title="Не хватило данных для проверки">?</span>';
    }
  }

  let ipHtml = '';
  if (method.primary_dns) {
    ipHtml += `
      <div class="dns-ip-row">
        <span class="dns-label">1</span>
        <span class="dns-ip" onclick="copyDNS('${method.primary_dns}', this)">
          <span class="copy-icon">📋</span> ${method.primary_dns}
        </span>
      </div>
    `;
  }
  if (method.secondary_dns && method.secondary_dns !== '0.0.0.0') {
    ipHtml += `
      <div class="dns-ip-row">
        <span class="dns-label">2</span>
        <span class="dns-ip" onclick="copyDNS('${method.secondary_dns}', this)">
          <span class="copy-icon">📋</span> ${method.secondary_dns}
        </span>
      </div>
    `;
  }

  // Статусы пользователей
  const allStatuses = getUserStatuses();
  const methodStatuses = allStatuses[method.id] || {};
  let worksCount = 0;
  const circlesHtml = USERS.map(name => {
    const st = methodStatuses[name] || 'untried';
    if (st === 'works') worksCount++;
    const isCurrent = name === currentUser ? ' current' : '';
    const initial = name.substring(0, 2).toUpperCase();
    return `<div class="user-circle ${st}${isCurrent}" data-method="${method.id}" data-user="${name}" onclick="toggleStatus(this)" title="${name}">${initial}</div>`;
  }).join('');

  const summaryText = worksCount > 0 ? `${worksCount}/${USERS.length}` : '';
  const recommendedBadge = isRecommended ? '<span class="recommended-badge">★</span>' : '';

  card.innerHTML = `
    <div class="dns-card-header">
      ${reachMarkHtml}
      ${recommendedBadge}
      ${statusHtml}
    </div>
    ${ipHtml}
    <div class="dns-meta">
      <span class="dns-sources">${sourceCount} ${sourceCount === 1 ? 'источник' : sourceCount < 5 ? 'источника' : 'источников'}</span>
    </div>
    <div class="user-statuses">
      ${circlesHtml}
      <span class="status-summary">${summaryText}</span>
    </div>
  `;

  return card;
}

// --- v1.0.6: массовая проверка доступа к Xbox ---

function hasVpnAcknowledged() {
  return localStorage.getItem('xbox_vpn_ack') === 'true';
}

function showVpnWarning() {
  document.getElementById('vpn-modal').classList.add('active');
  lockBodyScroll();
}

function acknowledgeVpn() {
  localStorage.setItem('xbox_vpn_ack', 'true');
  closeModal('vpn-modal');
  // После подтверждения сразу запускаем проверку
  runFullCheck();
}

function loadReachabilityCache() {
  try {
    const raw = localStorage.getItem('xbox_reach_results');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.timestamp || !parsed.results) return;
    if (Date.now() - parsed.timestamp < REACH_CACHE_TTL_MS) {
      reachabilityResults = parsed.results;
      lastCheckAt = parsed.timestamp;
      lastResolveFailures = parsed.resolveFailures || 0;
      lastIpv6Skipped = parsed.ipv6Skipped || 0;
    }
  } catch {}
}

function saveReachabilityCache() {
  if (!reachabilityResults || !lastCheckAt) return;
  localStorage.setItem('xbox_reach_results', JSON.stringify({
    timestamp: lastCheckAt,
    results: reachabilityResults,
    resolveFailures: lastResolveFailures,
    ipv6Skipped: lastIpv6Skipped,
  }));
}

// Делает свежий резолв DNS через нашу Vercel-функцию.
// Возвращает resolved_ip или null если функция не ответила (timeout/network).
async function fetchResolveDns(dns) {
  try {
    const resp = await fetch(`${RESOLVE_API}?dns=${encodeURIComponent(dns)}`, {
      cache: 'no-store',
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.resolved_ip || null;
  } catch {
    return null;
  }
}

// Пробует достучаться до IP по HTTPS с no-cors fetch.
// Возвращает true если хост ответил (любой response, opaque), false при таймауте/ошибке.
async function probeIp(ip) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`https://${ip}/`, {
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store',
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Главный оркестратор Phase 5: реальная проверка доступности всех путей
// к Xbox из сети пользователя.
async function runFullCheck(forceRefresh = false) {
  if (checkInProgress) return;

  // Первый клик — показать предупреждение про VPN/router
  if (!hasVpnAcknowledged()) {
    showVpnWarning();
    return;
  }

  // Свежий кэш — не трогаем (кроме forceRefresh)
  if (!forceRefresh && reachabilityResults && lastCheckAt
      && Date.now() - lastCheckAt < REACH_CACHE_TTL_MS) {
    return;
  }

  if (!appData) return;

  checkInProgress = true;
  const btn = document.getElementById('check-all-btn');
  btn.disabled = true;
  btn.classList.add('checking');

  const setProgress = (label) => {
    btn.innerHTML = `<span class="check-all-spinner"></span><span>${label}</span>`;
  };
  setProgress('Готовлю проверку...');

  try {
    // Шаг 1: классификация методов
    // Для каждого метода определяем, какой target IP пробовать (или пропустить)
    const methods = appData.methods.filter(m => m.active !== false);
    const methodTarget = {};      // methodId -> target IP или null (пропустить → unknown)
    const dnsToResolve = [];      // [{id, dns}] — DNS без cached resolved_ip
    let ipv6Skipped = 0;
    let notWorkingSkipped = 0;

    for (const m of methods) {
      if (m.type === 'xsts_ip') {
        methodTarget[m.id] = m.primary_dns;
        continue;
      }
      if (m.type !== 'dns_pair') {
        methodTarget[m.id] = null;
        continue;
      }
      // dns_pair
      if (isIPv6(m.primary_dns)) {
        methodTarget[m.id] = null;
        ipv6Skipped++;
        continue;
      }
      const dnsCheck = m.dns_check || {};
      // not_working DNS возвращает Azure IP — bypass не работает в принципе.
      // Пропускаем (mark as unknown), статус-бейдж «Не обходит» уже даёт сигнал.
      if (dnsCheck.status === 'not_working') {
        methodTarget[m.id] = null;
        notWorkingSkipped++;
        continue;
      }
      // Есть кэш target IP — пробуем его
      if (dnsCheck.resolved_ip) {
        methodTarget[m.id] = dnsCheck.resolved_ip;
        continue;
      }
      // Нет кэша — нужен свежий резолв через Vercel
      dnsToResolve.push({ id: m.id, dns: m.primary_dns });
    }

    // Шаг 2: параллельный свежий резолв для DNS без кэша
    let resolveFailed = 0;
    if (dnsToResolve.length > 0) {
      setProgress(`Резолвлю ${dnsToResolve.length} DNS...`);
      let resolveDone = 0;
      await Promise.all(dnsToResolve.map(async ({ id, dns }) => {
        const resolved = await fetchResolveDns(dns);
        if (resolved) {
          methodTarget[id] = resolved;
        } else {
          methodTarget[id] = null;
          resolveFailed++;
        }
        resolveDone++;
        setProgress(`Резолвлю DNS... ${resolveDone} / ${dnsToResolve.length}`);
      }));
    }

    // Шаг 3: дедупликация target IPs
    const uniqueTargets = [...new Set(Object.values(methodTarget).filter(t => t))];

    // Шаг 4: параллельный probe всех уникальных target IPs
    const targetResults = {};
    if (uniqueTargets.length > 0) {
      setProgress(`Проверяю ${uniqueTargets.length} путей...`);
      let probeDone = 0;
      await Promise.all(uniqueTargets.map(async (ip) => {
        const reachable = await probeIp(ip);
        targetResults[ip] = reachable ? 'reachable' : 'unreachable';
        probeDone++;
        setProgress(`Проверяю пути... ${probeDone} / ${uniqueTargets.length}`);
      }));
    }

    // Шаг 5: маппинг результатов обратно на методы
    const results = {};
    for (const m of methods) {
      const target = methodTarget[m.id];
      if (!target) {
        results[m.id] = 'unknown';
      } else {
        results[m.id] = targetResults[target] || 'unknown';
      }
    }

    reachabilityResults = results;
    lastCheckAt = Date.now();
    lastResolveFailures = resolveFailed;
    lastIpv6Skipped = ipv6Skipped;
    saveReachabilityCache();
    renderAll();
  } catch (err) {
    // Аварийный fallback — баннер с ошибкой и пустые результаты
    console.error('runFullCheck failed:', err);
    setProgress('Ошибка проверки');
    setTimeout(() => {
      btn.innerHTML = '<span class="check-all-icon">⚡</span><span class="check-all-text">Попробовать ещё раз</span>';
    }, 1500);
  } finally {
    checkInProgress = false;
    btn.disabled = false;
    btn.classList.remove('checking');
    if (reachabilityResults) {
      btn.innerHTML = '<span class="check-all-icon">⚡</span><span class="check-all-text">Проверить ещё раз</span>';
    } else {
      btn.innerHTML = '<span class="check-all-icon">⚡</span><span class="check-all-text">Проверить мой доступ к Xbox</span>';
    }
  }
}

function renderReachabilityResult() {
  const el = document.getElementById('reachability-result');
  if (!reachabilityResults) {
    el.innerHTML = '';
    return;
  }

  const entries = Object.values(reachabilityResults);
  const total = entries.length;
  const reachable = entries.filter(r => r === 'reachable').length;
  const unknown = entries.filter(r => r === 'unknown').length;

  const when = new Date(lastCheckAt).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit'
  });

  const bigClass = reachable === 0 ? 'reach-big zero' : 'reach-big';

  // Раскладка серых "?" — почему они unknown:
  // - lastIpv6Skipped: IPv6 DNS, мы их не проверяем
  // - lastResolveFailures: DNS у которых /api/resolve не сработал
  // - остальное (если есть) — not_working DNS, для них статус-бейдж даёт ответ
  const unknownNotes = [];
  if (lastIpv6Skipped > 0) {
    unknownNotes.push(`${lastIpv6Skipped} IPv6 не проверяется`);
  }
  if (lastResolveFailures > 0) {
    unknownNotes.push(`${lastResolveFailures} DNS не удалось разрешить`);
  }
  const unknownHtml = unknownNotes.length > 0
    ? `<div class="reach-unknown-note">${unknownNotes.join(' · ')}</div>`
    : '';

  // Главное предупреждение если 0 рабочих
  const warningHtml = reachable === 0
    ? `<div class="reach-warning">Ни один путь недоступен из твоей сети. Возможно у тебя включён VPN — выключи и нажми «Обновить». Если без VPN тоже 0 — нужен VPN на роутере для всего трафика к xsts.</div>`
    : '';

  el.innerHTML = `
    <div class="reach-aggregate">
      <div class="reach-numbers">
        <span class="${bigClass}">${reachable}</span>
        <span class="reach-small">из ${total}</span>
      </div>
      <div class="reach-label">путей доступны из твоей сети</div>
      ${unknownHtml}
      ${warningHtml}
      <div class="reach-meta">
        <span>Проверено в ${when}</span>
        <button class="reach-refresh-btn" onclick="runFullCheck(true)">Обновить</button>
      </div>
    </div>
  `;
}

function toggleReachableFilter() {
  filterReachable = !filterReachable;
  renderAll();
}

// --- Переключение статуса ---

function toggleStatus(el) {
  const methodId = el.dataset.method;
  const userName = el.dataset.user;
  const currentUser = getCurrentUser();

  if (userName !== currentUser) return;

  const allStatuses = getUserStatuses();
  const current = allStatuses[methodId]?.[userName] || 'untried';
  const idx = STATUS_CYCLE.indexOf(current);
  const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];

  setUserStatus(methodId, userName, next);
  renderAll();
}

// --- Инициализация ---

async function init() {
  if (!getCurrentUser()) {
    showUserPicker();
  }

  document.getElementById('change-user').onclick = showUserPicker;
  document.getElementById('help-btn').onclick = showHelp;

  // Help-модалку разрешаем закрывать по клику на overlay (UX-фикс из Phase 4 feedback).
  // User-picker и VPN-модалку по overlay НЕ закрываем — они требуют осознанного подтверждения.
  bindOverlayClose('help-modal');

  // v1.0.6: вся reachability-фича выключена через REACH_CHECK_ENABLED флаг.
  // Скрываем секцию с кнопкой и плейсхолдером результата.
  if (REACH_CHECK_ENABLED) {
    document.getElementById('check-all-btn').onclick = () => runFullCheck(false);
    loadReachabilityCache();
    if (reachabilityResults) {
      const btn = document.getElementById('check-all-btn');
      btn.innerHTML = '<span class="check-all-icon">⚡</span><span class="check-all-text">Проверить ещё раз</span>';
    }
  } else {
    const section = document.getElementById('reachability-section');
    if (section) section.style.display = 'none';
    // Чистим протухший кэш мок-результатов из Phase 4 (mock-данные больше не нужны)
    try { localStorage.removeItem('xbox_reach_results'); } catch {}
  }

  try {
    const resp = await fetch('data.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    appData = await resp.json();
    renderAll();
  } catch (e) {
    document.getElementById('methods-container').innerHTML =
      '<div class="empty-state">Не удалось загрузить данные</div>';
  }
}

init();
