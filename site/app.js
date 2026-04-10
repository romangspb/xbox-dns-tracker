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
};

const CHECK_STATUS_HINTS = {
  working: 'DNS обходит блокировку Xbox',
  not_working: 'DNS не обходит блокировку — стандартный резолв',
  unsafe: 'DNS подменяет обычные сайты — может быть опасен',
  timeout: 'DNS-сервер не ответил за 5 секунд',
  error: 'Ошибка при проверке',
  unchecked: 'Ещё не проверялся',
};

const DIFFICULTY_LABELS = {
  easy: 'Для прописывания в Xbox',
  medium: 'Настройка на роутере',
  hard: 'Продвинутый способ',
};

const DIFFICULTY_ORDER = ['easy', 'medium', 'hard'];

// Фильтры
let filterType = 'dns';       // 'dns' | 'xsts'
let filterStatus = 'all';     // 'all' | 'working' | 'timeout' | ...

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

// --- Модальное окно ---

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

function setFilter(type, status) {
  if (type !== undefined) filterType = type;
  if (status !== undefined) filterStatus = status;
  renderAll();
}

function renderFilters() {
  const container = document.getElementById('filters');
  if (!appData) return;

  // Считаем количество по типам
  const methods = appData.methods.filter(m => m.active !== false);
  const dnsCount = methods.filter(m => m.type === 'dns_pair').length;
  const xstsCount = methods.filter(m => m.type === 'xsts_ip').length;

  // Считаем количество по статусам для текущего типа
  const currentType = filterType === 'dns' ? 'dns_pair' : 'xsts_ip';
  const typed = methods.filter(m => m.type === currentType);
  const statusCounts = {};
  typed.forEach(m => {
    const s = m.dns_check?.status || 'unchecked';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  // Фильтр по типу
  const typeFilters = `
    <div class="filter-group">
      <button class="filter-btn ${filterType === 'dns' ? 'active' : ''}" onclick="setFilter('dns')">
        DNS для Xbox <span class="filter-count">${dnsCount}</span>
      </button>
      <button class="filter-btn ${filterType === 'xsts' ? 'active' : ''}" onclick="setFilter('xsts')">
        xsts IP для роутера <span class="filter-count">${xstsCount}</span>
      </button>
    </div>
  `;

  // Фильтр по статусу
  const statusOptions = [
    { key: 'all', label: 'Все' },
    { key: 'working', label: 'Работает' },
    { key: 'timeout', label: 'Не отвечает' },
    { key: 'unsafe', label: 'Небезопасен' },
    { key: 'not_working', label: 'Не обходит' },
    { key: 'unchecked', label: 'Не проверен' },
  ];

  const allCount = typed.length;
  const statusFilters = statusOptions
    .filter(o => o.key === 'all' || statusCounts[o.key])
    .map(o => {
      const cnt = o.key === 'all' ? allCount : (statusCounts[o.key] || 0);
      return `<button class="status-filter-btn ${filterStatus === o.key ? 'active' : ''}" onclick="setFilter(undefined, '${o.key}')">${o.label} <span class="filter-count">${cnt}</span></button>`;
    }).join('');

  container.innerHTML = `
    ${typeFilters}
    <div class="status-filters">${statusFilters}</div>
  `;
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

  // Фильтры
  renderFilters();

  // Фильтрация по типу
  const targetType = filterType === 'dns' ? 'dns_pair' : 'xsts_ip';
  let methods = appData.methods.filter(m => m.active !== false && m.type === targetType);

  // Фильтрация по статусу
  if (filterStatus !== 'all') {
    methods = methods.filter(m => (m.dns_check?.status || 'unchecked') === filterStatus);
  }

  // Сортировка: working первыми, потом по количеству источников
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
  if (filterType === 'dns') {
    const hint = document.createElement('div');
    hint.className = 'instruction';
    hint.innerHTML = 'Нажми на IP чтобы скопировать → <strong>Настройки Xbox</strong> → Сеть → Дополнительные → DNS (вручную)';
    container.appendChild(hint);
  } else {
    const hint = document.createElement('div');
    hint.className = 'instruction';
    hint.innerHTML = 'IP для подмены <strong>xsts.auth.xboxlive.com</strong> на роутере (static DNS record)';
    container.appendChild(hint);
  }

  // Группировка по сложности (только для dns)
  if (filterType === 'dns') {
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
    // xsts — плоский список
    methods.forEach(m => container.appendChild(renderCard(m, user)));
  }
}

function renderCard(method, currentUser) {
  const card = document.createElement('div');
  const diff = method.difficulty || 'easy';
  card.className = `dns-card ${diff}`;

  const checkStatus = method.dns_check?.status || 'unchecked';
  const statusLabel = CHECK_STATUS_LABELS[checkStatus] || checkStatus;
  const statusHint = CHECK_STATUS_HINTS[checkStatus] || '';
  const sourceCount = method.sources?.length || 0;
  const isRecommended = checkStatus === 'working' && sourceCount >= 2;

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
    return `<div class="user-circle ${st}${isCurrent}" data-method="${method.id}" data-user="${name}" onclick="toggleStatus(this)" title="${name}: нажми чтобы отметить">${initial}</div>`;
  }).join('');

  const summaryText = worksCount > 0 ? `${worksCount}/${USERS.length}` : '';
  const recommendedBadge = isRecommended ? '<span class="recommended-badge">★</span>' : '';

  card.innerHTML = `
    <div class="dns-card-header">
      ${recommendedBadge}
      <span class="dns-status ${checkStatus}" title="${statusHint}">${statusLabel}</span>
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
