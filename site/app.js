// Xbox DNS Tracker — app.js

const USERS = ['Рома', 'Дима', 'Саша', 'Макс', 'Влад'];
const STATUS_CYCLE = ['untried', 'works', 'not-works']; // серый → зелёный → красный
const STATUS_LABELS = {
  working: 'Работает',
  not_working: 'Не работает',
  unsafe: 'Небезопасен',
  timeout: 'Таймаут',
  error: 'Ошибка',
  unchecked: 'Не проверен',
};
const DIFFICULTY_LABELS = {
  easy: 'Простой',
  medium: 'Средний',
  hard: 'Сложный',
};
const DIFFICULTY_ORDER = ['easy', 'medium', 'hard'];

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
    el.textContent = 'Скопировано';
    el.classList.add('copied');
    setTimeout(() => {
      el.textContent = text;
      el.classList.remove('copied');
    }, 1500);
  }).catch(() => {
    // Fallback для старых браузеров
    prompt('Скопируйте DNS:', text);
  });
}

// --- Рендер ---

let appData = null;

function renderAll() {
  if (!appData) return;
  const container = document.getElementById('methods-container');
  const user = getCurrentUser();

  // Обновить время
  const updatedEl = document.getElementById('updated-at');
  const date = new Date(appData.updated_at);
  updatedEl.textContent = 'Обновлено: ' + date.toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });

  // Только активные dns_pair
  const methods = appData.methods.filter(m => m.active !== false && m.type === 'dns_pair');

  // Группировка по сложности
  const grouped = {};
  DIFFICULTY_ORDER.forEach(d => grouped[d] = []);
  methods.forEach(m => {
    const d = m.difficulty || 'easy';
    if (grouped[d]) grouped[d].push(m);
    else grouped.easy.push(m);
  });

  // Сортировка: working первыми
  Object.values(grouped).forEach(list => {
    list.sort((a, b) => {
      const aW = a.dns_check?.status === 'working' ? 0 : 1;
      const bW = b.dns_check?.status === 'working' ? 0 : 1;
      return aW - bW;
    });
  });

  container.innerHTML = '';

  DIFFICULTY_ORDER.forEach(diff => {
    const list = grouped[diff];
    if (!list.length) return;

    const section = document.createElement('div');
    section.className = 'difficulty-section';

    section.innerHTML = `
      <div class="difficulty-header">
        <span class="difficulty-badge ${diff}">${DIFFICULTY_LABELS[diff]}</span>
        <span class="difficulty-count">${list.length} шт.</span>
      </div>
    `;

    list.forEach(m => {
      section.appendChild(renderCard(m, user));
    });

    container.appendChild(section);
  });

  // xsts_ip методы
  const xstsMethods = appData.methods.filter(m => m.active !== false && m.type === 'xsts_ip');
  if (xstsMethods.length) {
    const section = document.createElement('div');
    section.className = 'difficulty-section';
    section.innerHTML = `
      <div class="difficulty-header">
        <span class="difficulty-badge medium">xsts IP</span>
        <span class="difficulty-count">${xstsMethods.length} шт. (для роутера)</span>
      </div>
    `;
    xstsMethods.forEach(m => section.appendChild(renderCard(m, user)));
    container.appendChild(section);
  }
}

function renderCard(method, currentUser) {
  const card = document.createElement('div');
  card.className = `dns-card ${method.difficulty || 'easy'}`;

  const checkStatus = method.dns_check?.status || 'unchecked';
  const statusLabel = STATUS_LABELS[checkStatus] || checkStatus;
  const sourceCount = method.sources?.length || 0;

  let ipHtml = '';
  if (method.primary_dns) {
    ipHtml += `
      <div class="dns-ip-row">
        <span class="dns-label">1</span>
        <span class="dns-ip" onclick="copyDNS('${method.primary_dns}', this)">${method.primary_dns}</span>
      </div>
    `;
  }
  if (method.secondary_dns && method.secondary_dns !== '0.0.0.0') {
    ipHtml += `
      <div class="dns-ip-row">
        <span class="dns-label">2</span>
        <span class="dns-ip" onclick="copyDNS('${method.secondary_dns}', this)">${method.secondary_dns}</span>
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
    const initial = name[0];
    return `<div class="user-circle ${st}${isCurrent}" data-method="${method.id}" data-user="${name}" onclick="toggleStatus(this)" title="${name}">${initial}</div>`;
  }).join('');

  const summaryText = worksCount > 0 ? `${worksCount}/${USERS.length}` : '';

  card.innerHTML = `
    <div class="dns-card-header">
      <span class="dns-type">${method.type === 'xsts_ip' ? 'xsts ip' : 'dns'}</span>
      <span class="dns-status ${checkStatus}">${statusLabel}</span>
    </div>
    ${ipHtml}
    <div class="dns-sources">${sourceCount} ${sourceCount === 1 ? 'источник' : sourceCount < 5 ? 'источника' : 'источников'}</div>
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

  // Можно менять только свой статус
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
  // Выбор пользователя
  if (!getCurrentUser()) {
    showUserPicker();
  }

  document.getElementById('change-user').onclick = showUserPicker;

  // Загрузка данных
  try {
    const resp = await fetch('data.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    appData = await resp.json();
    renderAll();
  } catch (e) {
    document.getElementById('methods-container').innerHTML =
      `<div class="loading">Не удалось загрузить данные</div>`;
  }
}

init();
