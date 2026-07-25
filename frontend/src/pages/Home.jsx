import React from 'react';
import { Link } from 'react-router-dom';
import Topbar from '../components/Topbar';
import Metrics from '../components/Metrics';
import '../styles/Home.css';

export default function Home({ apiBase, setApiBase, health, lastSync, context }) {
  return (
    <>
      <header className="hero compact-hero">
        <Topbar apiBase={apiBase} setApiBase={setApiBase} showToast={context.showToast} />
        <section id="top" className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Overview</p>
            <h1>学习进度，一眼看清。</h1>
            <p>总览页只展示服务状态、计划统计和下一步行动。</p>
            <div className="hero-actions">
              <button className="button primary" type="button" onClick={() => context.refreshAll()} disabled={context.busy.refreshAll}>{context.busy.refreshAll ? '刷新中...' : '刷新总览'}</button>
              <Link className="button subtle" to="/plan">管理计划</Link>
              <Link className="button subtle" to="/notes">整理笔记</Link>
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
            <Link className="button primary" to="/plan">查看学习计划</Link>
          </article>
          <article className="panel quick-card">
            <p className="eyebrow">Notes</p>
            <h2>学习笔记</h2>
            <p>主题、Markdown 上传和文件列表集中在笔记页维护。</p>
            <Link className="button ghost" to="/notes">打开学习笔记</Link>
          </article>
        </section>
      </main>
    </>
  );
}
