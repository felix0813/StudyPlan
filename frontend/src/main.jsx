import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';

const API_BASE_KEY = 'studyplan_api_base';
const DEFAULT_BACKEND_PORT = '8080';
const DEFAULT_SAMPLE_PLAN = [
  '读完一章课程',
  '整理今天的重点',
  '完成一次练习',
  '复盘还没掌握的内容',
];

function getDefaultApiBase() {
  if (window.location.origin === 'null') return `http://localhost:${DEFAULT_BACKEND_PORT}`;
  const { protocol, hostname, port } = window.location;
  const isLocalPreview = ['localhost', '127.0.0.1', '::1'].includes(hostname) && port && port !== DEFAULT_BACKEND_PORT;
  if (isLocalPreview) return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
  return window.location.origin;
}

function normalizeBase(value) {
  return (value || '').trim().replace(/\/+$/, '');
}

function detectPage() {
  const page = document.body.dataset.page;
  if (page) return page;
  const filename = window.location.pathname.split('/').pop();
  if (filename === 'plan.html') return 'plan';
  if (filename === 'notes.html') return 'notes';
  return 'home';
}

function formatDate(value) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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

function getLocalSummary(plan) {
  const total = plan.length;
  const completed = plan.filter((item) => item.status).length;
  return { total, completed, incomplete: Math.max(total - completed, 0) };
}

function getLocalNextTask(plan) {
  return plan.find((item) => !item.status)?.content || '暂无下一步';
}

function EmptyState({ message = '暂无内容', detail = '添加计划或笔记后，这里会显示进展。' }) {
  return (
    <div className="empty-state">
      <span>📚</span>
      <strong>{message}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Toast({ toast }) {
  return (
    <div className={`toast ${toast.message ? 'show' : ''} ${toast.type === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
      {toast.message}
    </div>
  );
}

function Topbar({ page, apiBase, setApiBase, showToast }) {
  const [draft, setDraft] = useState(apiBase);

  useEffect(() => {
    setDraft(apiBase);
  }, [apiBase]);

  const saveApiBase = () => {
    const value = normalizeBase(draft) || getDefaultApiBase();
    setApiBase(value);
    localStorage.setItem(API_BASE_KEY, value);
    setDraft(value);
    showToast('服务地址已保存');
  };

  return (
    <nav className="topbar" aria-label="顶部导航">
      <a className="brand" href="./index.html" aria-label="StudyPlan 首页">
        <span className="brand-mark" aria-hidden="true">
          <img src="./favicon.svg" alt="" />
        </span>
        <span>
          <strong>StudyPlan</strong>
          <small>学习小站</small>
        </span>
      </a>
      <div className="page-nav" aria-label="页面导航">
        <a className={`nav-link ${page === 'home' ? 'active' : ''}`} href="./index.html" aria-current={page === 'home' ? 'page' : undefined}>总览</a>
        <a className={`nav-link ${page === 'plan' ? 'active' : ''}`} href="./plan.html" aria-current={page === 'plan' ? 'page' : undefined}>学习计划</a>
        <a className={`nav-link ${page === 'notes' ? 'active' : ''}`} href="./notes.html" aria-current={page === 'notes' ? 'page' : undefined}>学习笔记</a>
      </div>
      <div className="api-config" aria-label="服务配置">
        <label htmlFor="apiBase">服务地址</label>
        <input id="apiBase" type="url" placeholder="http://localhost:8080" autoComplete="off" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button className="button ghost" type="button" onClick={saveApiBase}>保存</button>
      </div>
    </nav>
  );
}

function Metrics({ summary }) {
  const rate = summary.total ? Math.round((summary.completed / summary.total) * 100) : 0;
  return (
    <section className="metrics" aria-label="学习计划统计">
      <article><span>总任务</span><strong>{summary.total}</strong></article>
      <article><span>已完成</span><strong>{summary.completed}</strong></article>
      <article><span>未完成</span><strong>{summary.incomplete}</strong></article>
      <article><span>完成率</span><strong>{rate}%</strong></article>
    </section>
  );
}

function App() {
  const page = detectPage();
  const [apiBase, setApiBase] = useState(() => localStorage.getItem(API_BASE_KEY) || getDefaultApiBase());
  const [plan, setPlan] = useState([]);
  const [summary, setSummary] = useState({ total: 0, completed: 0, incomplete: 0 });
  const [nextTask, setNextTask] = useState('刷新后显示');
  const [titles, setTitles] = useState([]);
  const [filesByTitle, setFilesByTitle] = useState({});
  const [health, setHealth] = useState({ statusText: '等待刷新', pulse: '', postgres: '—', oss: '—' });
  const [lastSync, setLastSync] = useState('尚未刷新');
  const [busy, setBusy] = useState({});
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const toastTimer = useRef();

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast({ message: '', type: 'success' }), 3200);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const apiURL = useCallback((path) => `${normalizeBase(apiBase)}${path}`, [apiBase]);

  const request = useCallback(async (path, options = {}) => {
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
  }, [apiURL]);

  const refreshPlanDetails = useCallback(async (currentPlan) => {
    setSummary(getLocalSummary(currentPlan));
    setNextTask(getLocalNextTask(currentPlan));
    const [summaryResult, nextResult] = await Promise.allSettled([
      request('/study/plan/status'),
      request('/study/plan/next'),
    ]);
    if (summaryResult.status === 'fulfilled') {
      const local = getLocalSummary(currentPlan);
      setSummary({
        total: summaryResult.value?.total ?? local.total,
        completed: summaryResult.value?.completed ?? local.completed,
        incomplete: summaryResult.value?.incomplete ?? local.incomplete,
      });
    } else {
      console.warn('刷新计划统计失败，已使用本地计划数据', summaryResult.reason);
    }
    if (nextResult.status === 'fulfilled') {
      const next = nextResult.value;
      setNextTask(next?.content || next?.item?.content || next?.message || getLocalNextTask(currentPlan));
    } else {
      console.warn('刷新下一步失败，已使用本地计划数据', nextResult.reason);
    }
  }, [request]);

  const loadPlan = useCallback(async () => {
    const data = await request('/study/plan');
    const nextPlan = Array.isArray(data) ? data : [];
    setPlan(nextPlan);
    await refreshPlanDetails(nextPlan);
  }, [refreshPlanDetails, request]);

  const loadTitles = useCallback(async () => {
    const data = await request('/study/titles');
    setTitles(Array.isArray(data) ? data : []);
  }, [request]);

  const checkHealth = useCallback(async () => {
    try {
      const data = await request('/study/health');
      setHealth({
        pulse: 'ok',
        statusText: data.status === 'ok' ? '状态正常' : '部分可用',
        postgres: friendlyStatus(data.postgres),
        oss: friendlyStatus(data.oss),
      });
      return data;
    } catch (error) {
      setHealth({ pulse: 'bad', statusText: '暂时连不上', postgres: '—', oss: '—' });
      throw error;
    }
  }, [request]);

  const refreshAll = useCallback(async ({ silent = false } = {}) => {
    setBusy((value) => ({ ...value, refreshAll: true }));
    const jobs = [];
    if (page === 'home') jobs.push({ name: '服务状态', run: checkHealth });
    if (page === 'home' || page === 'plan') jobs.push({ name: '学习计划', run: loadPlan });
    if (page === 'notes') jobs.push({ name: '学习笔记', run: loadTitles });

    const results = await Promise.allSettled(jobs.map((job) => job.run()));
    const failed = results
      .map((result, index) => ({ result, name: jobs[index].name }))
      .filter(({ result }) => result.status === 'rejected');

    if (page === 'home') setLastSync(`上次刷新：${new Date().toLocaleString('zh-CN')}`);
    if (!silent) {
      if (failed.length) {
        showToast(`${failed.map((item) => item.name).join('、')}刷新失败：${failed[0].result.reason.message}`, 'error');
      } else {
        showToast('数据已刷新');
      }
    }
    setBusy((value) => ({ ...value, refreshAll: false }));
  }, [checkHealth, loadPlan, loadTitles, page, showToast]);

  useEffect(() => {
    if (page === 'home') {
      refreshAll({ silent: true });
      const onVisibilityChange = () => {
        if (!document.hidden) refreshAll({ silent: true });
      };
      const onFocus = () => refreshAll({ silent: true });
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('focus', onFocus);
      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onFocus);
      };
    }
    if (page === 'plan') loadPlan().catch((error) => showToast(error.message, 'error'));
    if (page === 'notes') loadTitles().catch((error) => showToast(error.message, 'error'));
  }, [loadPlan, loadTitles, page, refreshAll, showToast]);

  const appContext = useMemo(() => ({
    apiBase,
    busy,
    filesByTitle,
    loadPlan,
    loadTitles,
    plan,
    refreshAll,
    request,
    setBusy,
    setFilesByTitle,
    setPlan,
    setSummary,
    setNextTask,
    setTitles,
    showToast,
    summary,
    titles,
    nextTask,
  }), [apiBase, busy, filesByTitle, loadPlan, loadTitles, plan, refreshAll, request, summary, titles, nextTask, showToast]);

  return (
    <>
      <div className="app-shell">
        {page === 'home' && <HomePage page={page} apiBase={apiBase} setApiBase={setApiBase} health={health} lastSync={lastSync} context={appContext} />}
        {page === 'plan' && <PlanPage page={page} apiBase={apiBase} setApiBase={setApiBase} context={appContext} />}
        {page === 'notes' && <NotesPage page={page} apiBase={apiBase} setApiBase={setApiBase} context={appContext} />}
      </div>
      <Toast toast={toast} />
    </>
  );
}

function HomePage({ page, apiBase, setApiBase, health, lastSync, context }) {
  return (
    <>
      <header className="hero compact-hero">
        <Topbar page={page} apiBase={apiBase} setApiBase={setApiBase} showToast={context.showToast} />
        <section id="top" className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Overview</p>
            <h1>学习进度，一眼看清。</h1>
            <p>总览页只展示服务状态、计划统计和下一步行动；计划与笔记已拆分到独立页面，避免内容堆叠。</p>
            <div className="hero-actions">
              <button className="button primary" type="button" onClick={() => context.refreshAll()} disabled={context.busy.refreshAll}>{context.busy.refreshAll ? '刷新中...' : '刷新总览'}</button>
              <a className="button subtle" href="./plan.html">管理计划</a>
              <a className="button subtle" href="./notes.html">整理笔记</a>
            </div>
          </div>
          <aside className="status-card" aria-live="polite">
            <div className="status-head">
              <span className={`pulse ${health.pulse}`} />
              <span>{health.statusText}</span>
            </div>
            <dl className="health-grid">
              <div><dt>计划状态</dt><dd>{health.postgres}</dd></div>
              <div><dt>笔记状态</dt><dd>{health.oss}</dd></div>
            </dl>
            <p id="lastSync">{lastSync}</p>
          </aside>
        </section>
      </header>
      <main>
        <Metrics summary={context.summary} />
        <section className="overview-grid" aria-label="快捷入口">
          <article className="panel quick-card">
            <p className="eyebrow">Next</p>
            <h2>下一步</h2>
            <p>{context.nextTask}</p>
            <a className="button primary" href="./plan.html">查看学习计划</a>
          </article>
          <article className="panel quick-card">
            <p className="eyebrow">Notes</p>
            <h2>学习笔记</h2>
            <p>主题、Markdown 上传和文件列表集中在笔记页维护。</p>
            <a className="button ghost" href="./notes.html">打开学习笔记</a>
          </article>
        </section>
      </main>
    </>
  );
}

function PageHero({ page, apiBase, setApiBase, title, eyebrow, description, showToast }) {
  return (
    <header className="hero page-hero">
      <Topbar page={page} apiBase={apiBase} setApiBase={setApiBase} showToast={showToast} />
      <div className="page-title">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}

function PlanPage({ page, apiBase, setApiBase, context }) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(context.plan.map((item) => item.content).join('\n'));
  }, [context.plan]);

  const savePlan = async (event) => {
    event.preventDefault();
    const lines = draft.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      context.showToast('请先写一个目标', 'error');
      return;
    }
    const existingByContent = new Map(context.plan.map((item) => [item.content, item.status]));
    const payload = lines.map((content) => ({ content, status: existingByContent.get(content) || false }));
    context.setBusy((value) => ({ ...value, savePlan: true }));
    try {
      await context.request('/study/plan', { method: 'POST', body: JSON.stringify(payload) });
      await context.loadPlan();
      context.showToast('计划已保存');
    } catch (error) {
      context.showToast(error.message, 'error');
    } finally {
      context.setBusy((value) => ({ ...value, savePlan: false }));
    }
  };

  const updatePlanItemStatus = async (id, status) => {
    context.setBusy((value) => ({ ...value, [`plan-${id}`]: true }));
    try {
      await context.request(`/study/plan/items/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await context.loadPlan();
      context.showToast(status ? '已完成' : '已取消完成');
    } catch (error) {
      context.showToast(error.message, 'error');
    } finally {
      context.setBusy((value) => ({ ...value, [`plan-${id}`]: false }));
    }
  };

  return (
    <>
      <PageHero page={page} apiBase={apiBase} setApiBase={setApiBase} title="学习计划" eyebrow="Plan" description="只保留目标录入、下一步和打卡列表，让计划维护更专注。" showToast={context.showToast} />
      <main>
        <Metrics summary={context.summary} />
        <section id="plan" className="panel plan-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Plan</p>
              <h2>目标与打卡</h2>
              <p>一行一个目标，完成后直接勾选。</p>
            </div>
            <button className="button ghost" type="button" onClick={() => context.loadPlan().catch((error) => context.showToast(error.message, 'error'))}>刷新计划</button>
          </div>
          <div className="next-card">
            <span>下一步</span>
            <strong>{context.nextTask}</strong>
          </div>
          <form className="composer" onSubmit={savePlan}>
            <label htmlFor="planInput">学习目标</label>
            <textarea id="planInput" rows="7" placeholder={'例如：\n读完一章课程\n整理今天的重点\n复盘错题'} value={draft} onChange={(event) => setDraft(event.target.value)} />
            <div className="form-actions">
              <button className="button primary" type="submit" disabled={context.busy.savePlan}>{context.busy.savePlan ? '保存中...' : '保存计划'}</button>
              <button className="button subtle" type="button" onClick={() => { setDraft(DEFAULT_SAMPLE_PLAN.join('\n')); context.showToast('已填入示例'); }}>填入示例</button>
            </div>
          </form>
          <div className="task-list" aria-live="polite">
            {context.plan.length ? context.plan.map((item) => (
              <article className="task-item" key={item.id}>
                <input className="task-check" type="checkbox" checked={Boolean(item.status)} disabled={context.busy[`plan-${item.id}`]} aria-label={`标记进度：${item.content}`} onChange={(event) => updatePlanItemStatus(item.id, event.target.checked)} />
                <div className={`task-content ${item.status ? 'completed' : ''}`}>{item.content}</div>
                <span className="task-position">#{item.position}</span>
              </article>
            )) : <EmptyState message="还没有计划" detail="添加计划后，这里会显示进展。" />}
          </div>
        </section>
      </main>
    </>
  );
}

function NotesPage({ page, apiBase, setApiBase, context }) {
  const [titleName, setTitleName] = useState('');

  const createTitle = async (event) => {
    event.preventDefault();
    const name = titleName.trim();
    if (!name) {
      context.showToast('请输入主题名称', 'error');
      return;
    }
    context.setBusy((value) => ({ ...value, createTitle: true }));
    try {
      await context.request('/study/titles', { method: 'POST', body: JSON.stringify({ name }) });
      setTitleName('');
      await context.loadTitles();
      context.showToast('主题已创建');
    } catch (error) {
      context.showToast(error.message, 'error');
    } finally {
      context.setBusy((value) => ({ ...value, createTitle: false }));
    }
  };

  const renameTitle = async (title) => {
    const name = prompt('请输入新的主题名称', title.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      context.showToast('主题名称不能为空', 'error');
      return;
    }
    try {
      await context.request(`/study/titles/${encodeURIComponent(title.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      await context.loadTitles();
      context.showToast('主题已改名');
    } catch (error) {
      context.showToast(error.message, 'error');
    }
  };

  const deleteTitle = async (title) => {
    if (!confirm(`确定删除“${title.name}”？相关笔记记录也会删除。`)) return;
    try {
      await context.request(`/study/titles/${encodeURIComponent(title.id)}`, { method: 'DELETE' });
      context.setFilesByTitle((value) => {
        const next = { ...value };
        delete next[title.id];
        return next;
      });
      await context.loadTitles();
      context.showToast('主题已删除');
    } catch (error) {
      context.showToast(error.message, 'error');
    }
  };

  const loadFiles = async (titleID) => {
    try {
      const files = await context.request(`/study/titles/${encodeURIComponent(titleID)}/files`);
      context.setFilesByTitle((value) => ({ ...value, [titleID]: Array.isArray(files) ? files : [] }));
      context.showToast('笔记已刷新');
    } catch (error) {
      context.showToast(error.message, 'error');
    }
  };

  const uploadFiles = async (event, titleID) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.querySelector('input[type="file"]');
    if (!input.files.length) {
      context.showToast('请选择至少一个笔记文件', 'error');
      return;
    }
    const data = new FormData();
    Array.from(input.files).forEach((file) => data.append('files', file));
    context.setBusy((value) => ({ ...value, [`upload-${titleID}`]: true }));
    try {
      await context.request(`/study/titles/${encodeURIComponent(titleID)}/files`, { method: 'POST', body: data });
      input.value = '';
      await loadFiles(titleID);
      await context.loadTitles();
      context.showToast('笔记已上传');
    } catch (error) {
      context.showToast(error.message, 'error');
    } finally {
      context.setBusy((value) => ({ ...value, [`upload-${titleID}`]: false }));
    }
  };

  return (
    <>
      <PageHero page={page} apiBase={apiBase} setApiBase={setApiBase} title="学习笔记" eyebrow="Notes" description="主题、文件上传和笔记列表单独管理，回顾时更清楚。" showToast={context.showToast} />
      <main>
        <section id="records" className="panel records-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Notes</p>
              <h2>主题与 Markdown 笔记</h2>
              <p>按主题整理笔记，回顾时更清楚。</p>
            </div>
            <button className="button ghost" type="button" onClick={() => context.loadTitles().catch((error) => context.showToast(error.message, 'error'))}>刷新主题</button>
          </div>
          <form className="inline-form" onSubmit={createTitle}>
            <label className="sr-only" htmlFor="titleName">新主题名称</label>
            <input id="titleName" type="text" maxLength="120" placeholder="新建主题，例如：英语阅读" value={titleName} onChange={(event) => setTitleName(event.target.value)} />
            <button className="button primary" type="submit" disabled={context.busy.createTitle}>{context.busy.createTitle ? '创建中...' : '新建主题'}</button>
          </form>
          <div className="title-list" aria-live="polite">
            {context.titles.length ? context.titles.map((title) => (
              <TitleCard
                key={title.id}
                title={title}
                files={context.filesByTitle[title.id]}
                uploadBusy={context.busy[`upload-${title.id}`]}
                onRename={() => renameTitle(title)}
                onDelete={() => deleteTitle(title)}
                onLoadFiles={() => loadFiles(title.id)}
                onUploadFiles={(event) => uploadFiles(event, title.id)}
              />
            )) : <EmptyState message="还没有主题" detail="添加笔记主题后，这里会显示内容。" />}
          </div>
        </section>
      </main>
    </>
  );
}

function TitleCard({ title, files, uploadBusy, onRename, onDelete, onLoadFiles, onUploadFiles }) {
  return (
    <article className="title-card">
      <div className="title-main">
        <div>
          <h3>{title.name}</h3>
          <p>更新 {formatDate(title.updated_at)} · 创建 {formatDate(title.created_at)}</p>
        </div>
        <div className="title-actions">
          <button className="button ghost" type="button" onClick={onRename}>改名</button>
          <button className="button subtle" type="button" onClick={onLoadFiles}>查看笔记</button>
          <button className="button danger" type="button" onClick={onDelete}>删除</button>
        </div>
      </div>
      <form className="file-tools" onSubmit={onUploadFiles}>
        <input type="file" name="files" accept=".md,.markdown,text/markdown" multiple aria-label="选择笔记文件" />
        <button className="button primary" type="submit" disabled={uploadBusy}>{uploadBusy ? '上传中...' : '上传笔记'}</button>
        <button className="button ghost" type="button" onClick={onLoadFiles}>刷新</button>
      </form>
      <div className="file-list">
        <FileList files={files} />
      </div>
    </article>
  );
}

function FileList({ files }) {
  if (!files) return <div className="empty-state"><strong>还未查看笔记</strong><p>点击“查看笔记”即可展开。</p></div>;
  if (!files.length) return <div className="empty-state"><strong>暂无笔记</strong><p>上传笔记后会显示在这里。</p></div>;
  return files.map((file) => (
    <div className="file-item" key={file.id || file.filename}>
      <div>
        <strong>{file.filename}</strong><br />
        <span>{formatBytes(file.size)} · {formatDate(file.created_at)}</span>
      </div>
      <span>已保存</span>
    </div>
  ));
}

createRoot(document.getElementById('root')).render(<App />);
