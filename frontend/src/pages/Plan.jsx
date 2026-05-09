import React, { useState, useEffect } from 'react';
import Topbar from '../components/Topbar';
import Metrics from '../components/Metrics';
import EmptyState from '../components/EmptyState';
import '../styles/Plan.css';

const DEFAULT_SAMPLE_PLAN = [
  '读完一章课程',
  '整理今天的重点',
  '完成一次练习',
  '复盘还没掌握的内容',
];

function PageHero({ title, eyebrow, description, apiBase, setApiBase, showToast }) {
  return (
    <header className="hero page-hero">
      <Topbar apiBase={apiBase} setApiBase={setApiBase} showToast={showToast} />
      <div className="page-title">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}

export default function Plan({ apiBase, setApiBase, context }) {
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
      <PageHero apiBase={apiBase} setApiBase={setApiBase} title="学习计划" eyebrow="Plan" description="只保留目标录入、下一步和打卡列表，让计划维护更专注。" showToast={context.showToast} />
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
            {context.plan.length ? [...context.plan].sort((a, b) => (a.status === b.status ? 0 : a.status ? 1 : -1)).map((item) => (
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
