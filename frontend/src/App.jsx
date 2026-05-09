import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Plan from './pages/Plan';
import Notes from './pages/Notes';
import NoteDetail from './pages/NoteDetail';
import Toast from './components/Toast';
import { request, getDefaultApiBase } from './services/api';
import './styles/App.css';

const API_BASE_KEY = 'studyplan_api_base';

function friendlyStatus(value) {
  return !value || value === 'ok' ? '正常' : '需检查';
}

function getLocalSummary(plan) {
  const total = plan.length;
  const completed = plan.filter((item) => item.status).length;
  return { total, completed, incomplete: Math.max(total - completed, 0) };
}

function getLocalNextTask(plan) {
  return plan.find((item) => !item.status)?.content || '暂无下一步';
}

export default function App() {
  const location = useLocation();
  const page = useMemo(() => {
    if (location.pathname === '/') return 'home';
    if (location.pathname === '/plan') return 'plan';
    if (location.pathname.startsWith('/notes')) return 'notes';
    return 'home';
  }, [location.pathname]);

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

  const apiRequest = useCallback((path, options) => request(apiBase, path, options), [apiBase]);

  const refreshPlanDetails = useCallback(async (currentPlan) => {
    setSummary(getLocalSummary(currentPlan));
    setNextTask(getLocalNextTask(currentPlan));
    const [summaryResult, nextResult] = await Promise.allSettled([
      apiRequest('/study/plan/status'),
      apiRequest('/study/plan/next'),
    ]);
    if (summaryResult.status === 'fulfilled') {
      const local = getLocalSummary(currentPlan);
      setSummary({
        total: summaryResult.value?.total ?? local.total,
        completed: summaryResult.value?.completed ?? local.completed,
        incomplete: summaryResult.value?.incomplete ?? local.incomplete,
      });
    }
    if (nextResult.status === 'fulfilled') {
      const next = nextResult.value;
      setNextTask(next?.content || next?.item?.content || next?.message || getLocalNextTask(currentPlan));
    }
  }, [apiRequest]);

  const loadPlan = useCallback(async () => {
    const data = await apiRequest('/study/plan');
    const nextPlan = Array.isArray(data) ? data : [];
    setPlan(nextPlan);
    await refreshPlanDetails(nextPlan);
  }, [refreshPlanDetails, apiRequest]);

  const loadFilesForTitle = useCallback(async (titleID, silent = false) => {
    try {
      const files = await apiRequest(`/study/titles/${encodeURIComponent(titleID)}/files`);
      setFilesByTitle((value) => ({ ...value, [titleID]: Array.isArray(files) ? files : [] }));
      if (!silent) showToast('笔记已刷新');
    } catch (error) {
      if (!silent) showToast(error.message, 'error');
    }
  }, [apiRequest, showToast]);

  const loadTitles = useCallback(async () => {
    const data = await apiRequest('/study/titles');
    const nextTitles = Array.isArray(data) ? data : [];
    setTitles(nextTitles);
  }, [apiRequest]);

  const checkHealth = useCallback(async () => {
    try {
      const data = await apiRequest('/study/health');
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
  }, [apiRequest]);

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
    } else if (page === 'plan') {
      loadPlan().catch((error) => showToast(error.message, 'error'));
    } else if (page === 'notes') {
      loadTitles().catch((error) => showToast(error.message, 'error'));
    }
  }, [page, refreshAll, loadPlan, loadTitles, showToast]);

  const appContext = useMemo(() => ({
    busy,
    filesByTitle,
    loadPlan,
    loadTitles,
    loadFilesForTitle,
    plan,
    refreshAll,
    request: apiRequest,
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
  }), [busy, filesByTitle, loadPlan, loadTitles, loadFilesForTitle, plan, refreshAll, apiRequest, summary, titles, nextTask, showToast]);

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Home page={page} apiBase={apiBase} setApiBase={setApiBase} health={health} lastSync={lastSync} context={appContext} />} />
        <Route path="/plan" element={<Plan page={page} apiBase={apiBase} setApiBase={setApiBase} context={appContext} />} />
        <Route path="/notes" element={<Notes page={page} apiBase={apiBase} setApiBase={setApiBase} context={appContext} />} />
        <Route path="/notes/:titleId" element={<NoteDetail page={page} apiBase={apiBase} setApiBase={setApiBase} context={appContext} />} />
      </Routes>
      <Toast toast={toast} />
    </div>
  );
}
