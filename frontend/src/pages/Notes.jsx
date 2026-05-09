import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Topbar from '../components/Topbar';
import EmptyState from '../components/EmptyState';
import '../styles/Notes.css';

function formatDate(value) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

function TitleCard({ title, onRename, onDelete, onViewNotes }) {
  return (
    <article className="title-card">
      <div className="title-main">
        <div>
          <h3>{title.name}</h3>
          <p>更新 {formatDate(title.updated_at)}</p>
          <p>创建 {formatDate(title.created_at)}</p>
        </div>
      </div>
      <div className="title-actions">
        <button className="button ghost" type="button" onClick={onRename}>改名</button>
        <button className="button subtle" type="button" onClick={onViewNotes}>查看笔记</button>
        <button className="button danger" type="button" onClick={onDelete}>删除</button>
      </div>
    </article>
  );
}

export default function Notes({ apiBase, setApiBase, context }) {
  const [titleName, setTitleName] = useState('');
  const navigate = useNavigate();

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
      await context.loadFilesForTitle(titleID, true);
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
      <PageHero apiBase={apiBase} setApiBase={setApiBase} title="学习笔记" eyebrow="Notes" description="主题、文件上传与笔记列表单独管理，回顾时更清楚。" showToast={context.showToast} />
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
                onRename={() => renameTitle(title)}
                onDelete={() => deleteTitle(title)}
                onViewNotes={() => navigate(`/notes/${title.id}`)}
              />
            )) : <EmptyState message="还没有主题" detail="添加笔记主题后，这里会显示内容。" />}
          </div>
        </section>
      </main>
    </>
  );
}
