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
      renderAll();
    };
    picker.appendChild(btn);
  });
  modal.classList.add('active');
}

function showHelp() {
  document.getElementById('help-modal').classList.add('active');
}

function showStatusPopup(status, el) {
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
    ] : [
      { key: 'all', label: 'Все' },
      { key: 'working', label: 'Работает' },
      { key: 'timeout', label: 'Не отвечает' },
      { key: 'unsafe', label: 'Небезопасен' },
      { key: 'not_working', label: 'Не обходит' },
      { key: 'unchecked', label: 'Не проверен' },
    ];

    const statusBtns = statusOptions
      .filter(o => o.key === 'all' || statusCounts[o.key])
      .map(o => {
        const cnt = o.key === 'all' ? typed.length : (statusCounts[o.key] || 0);
        const active = filterStatuses.has(o.key) ? ' active' : '';
        return `<button class="status-filter-btn${active}" onclick="toggleStatusFilter('${o.key}')">${o.label} <span class="filter-count">${cnt}</span></button>`;
      }).join('');

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
    hint.innerHTML = 'IPv6 DNS → <strong>Настройки Xbox</strong> → Сеть → Дополнительные → DNS (вручную) → IPv6';
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
  let statusHtml = `<span class="dns-status ${checkStatus}" onclick="showStatusPopup('${checkStatus}', this)">${statusLabel}</span>`;
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

  // Cache busting: добавляем timestamp к запросу data.json
  try {
    const resp = await fetch('data.json?t=' + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    appData = await resp.json();
    renderAll();
  } catch (e) {
    document.getElementById('methods-container').innerHTML =
      '<div class="empty-state">Не удалось загрузить данные</div>';
  }
}

init();
