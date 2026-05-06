const API_BASE_KEY = 'studyplan_api_base';
const DEFAULT_SAMPLE_PLAN = [
  '阅读 Go HTTP 标准库并整理请求处理笔记',
  '完成 PostgreSQL 连接池与迁移实践',
  '上传本周 Markdown 学习记录',
  '复盘未完成内容并安排下一次学习'
];

const state = {
  apiBase: localStorage.getItem(API_BASE_KEY) || window.location.origin,
  plan: [],
  titles: [],
  filesByTitle: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const emptyTemplate = $('#emptyStateTemplate');

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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `请求失败：${response.status}`);
  }
  return data;
}

function showToast(message, type = 'success') {
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${type === 'error' ? 'error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.className = 'toast';
  }, 3200);
}

function setBusy(button, busy, labelWhenBusy = '处理中...') {
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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function updateSummary(summary) {
  const total = summary?.total ?? state.plan.length;
  const completed = summary?.completed ?? state.plan.filter((item) => item.status).length;
  const incomplete = summary?.incomplete ?? Math.max(total - completed, 0);
  const rate = total ? Math.round((completed / total) * 100) : 0;
  elements.totalCount.textContent = total;
  elements.completedCount.textContent = completed;
  elements.incompleteCount.textContent = incomplete;
  elements.completionRate.textContent = `${rate}%`;
}

function renderPlan() {
  if (!state.plan.length) {
    renderEmpty(elements.planList, '还没有学习计划');
    elements.planInput.value = '';
    updateSummary({ total: 0, completed: 0, incomplete: 0 });
    elements.nextTask.textContent = '暂无未完成任务';
    return;
  }

  elements.planInput.value = state.plan.map((item) => item.content).join('\n');
  const fragment = document.createDocumentFragment();
  state.plan.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'task-item';
    const checkbox = document.createElement('input');
    checkbox.className = 'task-check';
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(item.status);
    checkbox.setAttribute('aria-label', `切换任务状态：${item.content}`);
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
  if (!state.titles.length) {
    renderEmpty(elements.titleList, '还没有学习记录标题');
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
  meta.textContent = `更新于 ${formatDate(title.updated_at)} · 创建于 ${formatDate(title.created_at)}`;
  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'title-actions';
  const renameButton = actionButton('重命名', 'ghost', () => renameTitle(title));
  const filesButton = actionButton('查看文件', 'subtle', () => loadFiles(title.id));
  const deleteButton = actionButton('删除', 'danger', () => deleteTitle(title));
  actions.append(renameButton, filesButton, deleteButton);
  main.append(info, actions);

  const tools = document.createElement('form');
  tools.className = 'file-tools';
  tools.innerHTML = `
    <input type="file" name="files" accept=".md,.markdown,text/markdown" multiple aria-label="选择 Markdown 文件">
    <button class="button primary" type="submit">上传 Markdown</button>
    <button class="button ghost" type="button" data-refresh-files>刷新文件</button>
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
    container.innerHTML = '<div class="empty-state"><strong>尚未加载文件</strong><p>点击“查看文件”获取该标题下的 Markdown 元数据。</p></div>';
    return;
  }
  if (!files.length) {
    container.innerHTML = '<div class="empty-state"><strong>暂无文件</strong><p>上传 .md 或 .markdown 文件后会显示在这里。</p></div>';
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
    key.textContent = file.oss_key;
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
    elements.healthPulse.className = 'pulse ok';
    elements.healthText.textContent = health.status === 'ok' ? '服务正常' : '服务降级';
    elements.pgStatus.textContent = health.postgres || 'ok';
    elements.ossStatus.textContent = health.oss || 'ok';
  } catch (error) {
    elements.healthPulse.className = 'pulse bad';
    elements.healthText.textContent = '连接异常';
    elements.pgStatus.textContent = '—';
    elements.ossStatus.textContent = '—';
    throw error;
  }
}

async function loadPlan() {
  const [plan, summary, next] = await Promise.all([
    request('/study/plan'),
    request('/study/plan/status'),
    request('/study/plan/next'),
  ]);
  state.plan = Array.isArray(plan) ? plan : [];
  renderPlan();
  updateSummary(summary);
  elements.nextTask.textContent = next?.content || next?.item?.content || next?.message || '暂无未完成任务';
}

async function loadTitles() {
  const titles = await request('/study/titles');
  state.titles = Array.isArray(titles) ? titles : [];
  renderTitles();
}

async function refreshAll() {
  setBusy(elements.refreshAll, true, '同步中...');
  try {
    await checkHealth();
    await Promise.all([loadPlan(), loadTitles()]);
    elements.lastSync.textContent = `上次同步：${new Date().toLocaleString('zh-CN')}`;
    showToast('数据同步完成');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.refreshAll, false);
  }
}

async function savePlan(event) {
  event.preventDefault();
  const lines = elements.planInput.value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    showToast('请至少填写一个学习任务', 'error');
    return;
  }
  const existingByContent = new Map(state.plan.map((item) => [item.content, item.status]));
  const payload = lines.map((content) => ({ content, status: existingByContent.get(content) || false }));
  const button = event.submitter;
  setBusy(button, true, '保存中...');
  try {
    await request('/study/plan', { method: 'POST', body: JSON.stringify(payload) });
    await loadPlan();
    showToast('学习计划已保存');
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
    showToast(status ? '任务已标记完成' : '任务已恢复未完成');
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
    showToast('请输入学习记录标题', 'error');
    return;
  }
  const button = event.submitter;
  setBusy(button, true, '新建中...');
  try {
    await request('/study/titles', { method: 'POST', body: JSON.stringify({ name }) });
    elements.titleName.value = '';
    await loadTitles();
    showToast('标题已创建');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function renameTitle(title) {
  const name = prompt('请输入新的标题名称', title.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    showToast('标题名称不能为空', 'error');
    return;
  }
  try {
    await request(`/study/titles/${encodeURIComponent(title.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: trimmed }),
    });
    await loadTitles();
    showToast('标题已重命名');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function deleteTitle(title) {
  if (!confirm(`确定删除“${title.name}”？数据库中的文件元数据会被删除。`)) return;
  try {
    await request(`/study/titles/${encodeURIComponent(title.id)}`, { method: 'DELETE' });
    state.filesByTitle.delete(title.id);
    await loadTitles();
    showToast('标题已删除');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadFiles(titleID) {
  try {
    const files = await request(`/study/titles/${encodeURIComponent(titleID)}/files`);
    state.filesByTitle.set(titleID, Array.isArray(files) ? files : []);
    refreshFilePanel(titleID);
    showToast('文件列表已刷新');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function uploadFiles(event, titleID) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.querySelector('input[type="file"]');
  if (!input.files.length) {
    showToast('请选择至少一个 Markdown 文件', 'error');
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
    showToast('Markdown 文件已上传');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function bindEvents() {
  elements.apiBase.value = state.apiBase;
  elements.saveApiBase.addEventListener('click', () => {
    const value = normalizeBase(elements.apiBase.value) || window.location.origin;
    state.apiBase = value;
    localStorage.setItem(API_BASE_KEY, value);
    elements.apiBase.value = value;
    showToast('API 地址已保存');
  });
  elements.refreshAll.addEventListener('click', refreshAll);
  elements.loadPlan.addEventListener('click', () => loadPlan().catch((error) => showToast(error.message, 'error')));
  elements.loadTitles.addEventListener('click', () => loadTitles().catch((error) => showToast(error.message, 'error')));
  elements.planForm.addEventListener('submit', savePlan);
  elements.titleForm.addEventListener('submit', createTitle);
  elements.useSamplePlan.addEventListener('click', () => {
    elements.planInput.value = DEFAULT_SAMPLE_PLAN.join('\n');
    showToast('已填入示例计划');
  });
}

bindEvents();
renderPlan();
renderTitles();
refreshAll();
