const API_BASE_KEY = 'studyplan_api_base';
const DEFAULT_BACKEND_PORT = '8080';
const DEFAULT_SAMPLE_PLAN = [
  '读完一章课程',
  '整理今天的重点',
  '完成一次练习',
  '复盘还没掌握的内容'
];

function getDefaultApiBase() {
  if (window.location.origin === 'null') return `http://localhost:${DEFAULT_BACKEND_PORT}`;
  const { protocol, hostname, port } = window.location;
  const isLocalPreview = ['localhost', '127.0.0.1', '::1'].includes(hostname) && port && port !== DEFAULT_BACKEND_PORT;
  if (isLocalPreview) return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
  return window.location.origin;
}

const state = {
  apiBase: localStorage.getItem(API_BASE_KEY) || getDefaultApiBase(),
  plan: [],
  titles: [],
  filesByTitle: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const emptyTemplate = $('#emptyStateTemplate');
const currentPage = document.body.dataset.page || 'home';

const elements = {
  apiBase: $('#apiBase'),
  saveApiBase: $('#saveApiBase'),
  refreshAll: $('#refreshAll'),
  loadPlan: $('#loadPlan'),
  loadTitles: $('#loadTitles'),
  planForm: $('#planForm'),
  planInput: $('#planInput'),
  useSamplePlan: $('#useSamplePlan'),
  planList: $('#planList'),
  titleForm: $('#titleForm'),
  titleName: $('#titleName'),
  titleList: $('#titleList'),
  healthPulse: $('#healthPulse'),
  healthText: $('#healthText'),
  pgStatus: $('#pgStatus'),
  ossStatus: $('#ossStatus'),
  lastSync: $('#lastSync'),
  totalCount: $('#totalCount'),
  completedCount: $('#completedCount'),
  incompleteCount: $('#incompleteCount'),
  completionRate: $('#completionRate'),
  nextTask: $('#nextTask'),
  toast: $('#toast'),
};

function normalizeBase(value) {
  return (value || '').trim().replace(/\/+$/, '');
}

function apiURL(path) {
  return `${normalizeBase(state.apiBase)}${path}`;
}

async function request(path, options = {}) {
  const init = {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
  };
  const response = await fetch(apiURL(path), init);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`服务返回内容不是 JSON，请检查服务地址：${apiURL(path)}`);
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `操作失败：${response.status}`);
  }
  return data;
}

function showToast(message, type = 'success') {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type === 'error' ? 'error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.className = 'toast';
  }, 3200);
}

function setBusy(button, busy, labelWhenBusy = '请稍候...') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = labelWhenBusy;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function renderEmpty(container, message = '暂无内容') {
  if (!container || !emptyTemplate) return;
  const node = emptyTemplate.content.cloneNode(true);
  node.querySelector('strong').textContent = message;
  container.replaceChildren(node);
}

function formatDate(value) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}

function friendlyStatus(value) {
  return !value || value === 'ok' ? '正常' : '需检查';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getLocalSummary() {
  const total = state.plan.length;
  const completed = state.plan.filter((item) => item.status).length;
  return { total, completed, incomplete: Math.max(total - completed, 0) };
}

function getLocalNextTask() {
  return state.plan.find((item) => !item.status)?.content || '暂无下一步';
}

function updateSummary(summary) {
  const local = getLocalSummary();
  const total = summary?.total ?? local.total;
  const completed = summary?.completed ?? local.completed;
  const incomplete = summary?.incomplete ?? local.incomplete;
  const rate = total ? Math.round((completed / total) * 100) : 0;
  if (elements.totalCount) elements.totalCount.textContent = total;
  if (elements.completedCount) elements.completedCount.textContent = completed;
  if (elements.incompleteCount) elements.incompleteCount.textContent = incomplete;
  if (elements.completionRate) elements.completionRate.textContent = `${rate}%`;
}

function renderPlan() {
  if (!elements.planList) return;
  if (!state.plan.length) {
    renderEmpty(elements.planList, '还没有计划');
    if (elements.planInput) elements.planInput.value = '';
    updateSummary({ total: 0, completed: 0, incomplete: 0 });
    if (elements.nextTask) elements.nextTask.textContent = '暂无下一步';
    return;
  }

  if (elements.planInput) elements.planInput.value = state.plan.map((item) => item.content).join('\n');
  const fragment = document.createDocumentFragment();
  state.plan.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'task-item';
    const checkbox = document.createElement('input');
    checkbox.className = 'task-check';
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(item.status);
    checkbox.setAttribute('aria-label', `标记进度：${item.content}`);
    checkbox.addEventListener('change', () => updatePlanItemStatus(item.id, checkbox.checked, checkbox));

    const content = document.createElement('div');
    content.className = `task-content ${item.status ? 'completed' : ''}`;
    content.textContent = item.content;

    const position = document.createElement('span');
    position.className = 'task-position';
    position.textContent = `#${item.position}`;

    card.append(checkbox, content, position);
    fragment.append(card);
  });
  elements.planList.replaceChildren(fragment);
}

function renderTitles() {
  if (!elements.titleList) return;
  if (!state.titles.length) {
    renderEmpty(elements.titleList, '还没有主题');
    return;
  }
  const fragment = document.createDocumentFragment();
  state.titles.forEach((title) => fragment.append(createTitleCard(title)));
  elements.titleList.replaceChildren(fragment);
}

function createTitleCard(title) {
  const card = document.createElement('article');
  card.className = 'title-card';
  card.dataset.titleId = title.id;

  const main = document.createElement('div');
  main.className = 'title-main';
  const info = document.createElement('div');
  const name = document.createElement('h3');
  name.textContent = title.name;
  const meta = document.createElement('p');
  meta.textContent = `更新 ${formatDate(title.updated_at)} · 创建 ${formatDate(title.created_at)}`;
  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'title-actions';
  const renameButton = actionButton('改名', 'ghost', () => renameTitle(title));
  const filesButton = actionButton('查看笔记', 'subtle', () => loadFiles(title.id));
  const deleteButton = actionButton('删除', 'danger', () => deleteTitle(title));
  actions.append(renameButton, filesButton, deleteButton);
  main.append(info, actions);

  const tools = document.createElement('form');
  tools.className = 'file-tools';
  tools.innerHTML = `
    <input type="file" name="files" accept=".md,.markdown,text/markdown" multiple aria-label="选择笔记文件">
    <button class="button primary" type="submit">上传笔记</button>
    <button class="button ghost" type="button" data-refresh-files>刷新</button>
  `;
  tools.addEventListener('submit', (event) => uploadFiles(event, title.id));
  tools.querySelector('[data-refresh-files]').addEventListener('click', () => loadFiles(title.id));

  const fileList = document.createElement('div');
  fileList.className = 'file-list';
  fileList.dataset.fileList = title.id;
  renderFilesInto(fileList, state.filesByTitle.get(title.id));

  card.append(main, tools, fileList);
  return card;
}

function actionButton(text, variant, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button ${variant}`;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function renderFilesInto(container, files) {
  if (!files) {
    container.innerHTML = '<div class="empty-state"><strong>还未查看笔记</strong><p>点击“查看笔记”即可展开。</p></div>';
    return;
  }
  if (!files.length) {
    container.innerHTML = '<div class="empty-state"><strong>暂无笔记</strong><p>上传笔记后会显示在这里。</p></div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  files.forEach((file) => {
    const row = document.createElement('div');
    row.className = 'file-item';
    const left = document.createElement('div');
    left.innerHTML = `<strong></strong><br><span></span>`;
    left.querySelector('strong').textContent = file.filename;
    left.querySelector('span').textContent = `${formatBytes(file.size)} · ${formatDate(file.created_at)}`;
    const key = document.createElement('span');
    key.textContent = '已保存';
    row.append(left, key);
    fragment.append(row);
  });
  container.replaceChildren(fragment);
}

function refreshFilePanel(titleID) {
  const container = document.querySelector(`[data-file-list="${CSS.escape(titleID)}"]`);
  if (container) renderFilesInto(container, state.filesByTitle.get(titleID));
}

async function checkHealth() {
  try {
    const health = await request('/study/health');
    if (!elements.healthPulse || !elements.healthText) return health;
    elements.healthPulse.className = 'pulse ok';
    elements.healthText.textContent = health.status === 'ok' ? '状态正常' : '部分可用';
    elements.pgStatus.textContent = friendlyStatus(health.postgres);
    elements.ossStatus.textContent = friendlyStatus(health.oss);
  } catch (error) {
    if (elements.healthPulse) elements.healthPulse.className = 'pulse bad';
    if (elements.healthText) elements.healthText.textContent = '暂时连不上';
    if (elements.pgStatus) elements.pgStatus.textContent = '—';
    if (elements.ossStatus) elements.ossStatus.textContent = '—';
    throw error;
  }
}

async function loadPlan() {
  const plan = await request('/study/plan');
  state.plan = Array.isArray(plan) ? plan : [];
  renderPlan();
  updateSummary();
  if (elements.nextTask) elements.nextTask.textContent = getLocalNextTask();

  const [summaryResult, nextResult] = await Promise.allSettled([
    request('/study/plan/status'),
    request('/study/plan/next'),
  ]);
  if (summaryResult.status === 'fulfilled') {
    updateSummary(summaryResult.value);
  } else {
    console.warn('刷新计划统计失败，已使用本地计划数据', summaryResult.reason);
  }
  if (nextResult.status === 'fulfilled' && elements.nextTask) {
    const next = nextResult.value;
    elements.nextTask.textContent = next?.content || next?.item?.content || next?.message || getLocalNextTask();
  } else if (nextResult.status === 'rejected') {
    console.warn('刷新下一步失败，已使用本地计划数据', nextResult.reason);
  }
}

async function loadTitles() {
  const titles = await request('/study/titles');
  state.titles = Array.isArray(titles) ? titles : [];
  renderTitles();
}

async function refreshAll({ silent = false } = {}) {
  setBusy(elements.refreshAll, true, '刷新中...');
  const jobs = [];
  if (elements.healthText) jobs.push({ name: '服务状态', run: checkHealth });
  if (elements.totalCount || elements.planList || elements.nextTask) jobs.push({ name: '学习计划', run: loadPlan });
  if (elements.titleList) jobs.push({ name: '学习笔记', run: loadTitles });

  const results = await Promise.allSettled(jobs.map((job) => job.run()));
  const failed = results
    .map((result, index) => ({ result, name: jobs[index].name }))
    .filter(({ result }) => result.status === 'rejected');

  if (elements.lastSync) elements.lastSync.textContent = `上次刷新：${new Date().toLocaleString('zh-CN')}`;
  if (!silent) {
    if (failed.length) {
      showToast(`${failed.map((item) => item.name).join('、')}刷新失败：${failed[0].result.reason.message}`, 'error');
    } else {
      showToast('数据已刷新');
    }
  }
  setBusy(elements.refreshAll, false);
}

async function savePlan(event) {
  event.preventDefault();
  const lines = elements.planInput.value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    showToast('请先写一个目标', 'error');
    return;
  }
  const existingByContent = new Map(state.plan.map((item) => [item.content, item.status]));
  const payload = lines.map((content) => ({ content, status: existingByContent.get(content) || false }));
  const button = event.submitter;
  setBusy(button, true, '保存中...');
  try {
    await request('/study/plan', { method: 'POST', body: JSON.stringify(payload) });
    await loadPlan();
    showToast('计划已保存');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function updatePlanItemStatus(id, status, checkbox) {
  checkbox.disabled = true;
  try {
    await request(`/study/plan/items/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await loadPlan();
    showToast(status ? '已完成' : '已取消完成');
  } catch (error) {
    checkbox.checked = !status;
    showToast(error.message, 'error');
  } finally {
    checkbox.disabled = false;
  }
}

async function createTitle(event) {
  event.preventDefault();
  const name = elements.titleName.value.trim();
  if (!name) {
    showToast('请输入主题名称', 'error');
    return;
  }
  const button = event.submitter;
  setBusy(button, true, '创建中...');
  try {
    await request('/study/titles', { method: 'POST', body: JSON.stringify({ name }) });
    elements.titleName.value = '';
    await loadTitles();
    showToast('主题已创建');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function renameTitle(title) {
  const name = prompt('请输入新的主题名称', title.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    showToast('主题名称不能为空', 'error');
    return;
  }
  try {
    await request(`/study/titles/${encodeURIComponent(title.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: trimmed }),
    });
    await loadTitles();
    showToast('主题已改名');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function deleteTitle(title) {
  if (!confirm(`确定删除“${title.name}”？相关笔记记录也会删除。`)) return;
  try {
    await request(`/study/titles/${encodeURIComponent(title.id)}`, { method: 'DELETE' });
    state.filesByTitle.delete(title.id);
    await loadTitles();
    showToast('主题已删除');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadFiles(titleID) {
  try {
    const files = await request(`/study/titles/${encodeURIComponent(titleID)}/files`);
    state.filesByTitle.set(titleID, Array.isArray(files) ? files : []);
    refreshFilePanel(titleID);
    showToast('笔记已刷新');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function uploadFiles(event, titleID) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.querySelector('input[type="file"]');
  if (!input.files.length) {
    showToast('请选择至少一个笔记文件', 'error');
    return;
  }
  const data = new FormData();
  Array.from(input.files).forEach((file) => data.append('files', file));
  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, '上传中...');
  try {
    await request(`/study/titles/${encodeURIComponent(titleID)}/files`, { method: 'POST', body: data });
    input.value = '';
    await loadFiles(titleID);
    await loadTitles();
    showToast('笔记已上传');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function bind(element, eventName, handler) {
  if (!element) return;
  element.addEventListener(eventName, handler);
}

function bindEvents() {
  if (elements.apiBase) elements.apiBase.value = state.apiBase;
  bind(elements.saveApiBase, 'click', () => {
    const value = normalizeBase(elements.apiBase ? elements.apiBase.value : '') || getDefaultApiBase();
    state.apiBase = value;
    localStorage.setItem(API_BASE_KEY, value);
    if (elements.apiBase) elements.apiBase.value = value;
    showToast('服务地址已保存');
  });
  bind(elements.refreshAll, 'click', refreshAll);
  bind(elements.loadPlan, 'click', () => loadPlan().catch((error) => showToast(error.message, 'error')));
  bind(elements.loadTitles, 'click', () => loadTitles().catch((error) => showToast(error.message, 'error')));
  bind(elements.planForm, 'submit', savePlan);
  bind(elements.titleForm, 'submit', createTitle);
  bind(elements.useSamplePlan, 'click', () => {
    if (elements.planInput) elements.planInput.value = DEFAULT_SAMPLE_PLAN.join('\n');
    showToast('已填入示例');
  });
  if (currentPage === 'home') {
    bind(document, 'visibilitychange', () => {
      if (!document.hidden) refreshAll({ silent: true });
    });
    bind(window, 'focus', () => refreshAll({ silent: true }));
  }
}

bindEvents();
if (currentPage === 'plan') {
  renderPlan();
  loadPlan().catch((error) => showToast(error.message, 'error'));
} else if (currentPage === 'notes') {
  renderTitles();
  loadTitles().catch((error) => showToast(error.message, 'error'));
} else {
  refreshAll({ silent: true });
}
