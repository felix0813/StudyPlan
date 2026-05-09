import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Topbar from '../components/Topbar';
import EmptyState from '../components/EmptyState';
import '../styles/NoteDetail.css';

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

export default function NoteDetail({ apiBase, setApiBase, context }) {
  const { titleId } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [content, setContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const titleData = await context.request(`/study/titles/${encodeURIComponent(titleId)}`);
      setTitle(titleData);
      const filesData = await context.request(`/study/titles/${encodeURIComponent(titleId)}/files`);
      setFiles(Array.isArray(filesData) ? filesData : []);
    } catch (error) {
      context.showToast(error.message, 'error');
      navigate('/notes');
    }
  }, [titleId, context, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const uploadFiles = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.querySelector('input[type="file"]');
    if (!input.files.length) {
      context.showToast('请选择至少一个笔记文件', 'error');
      return;
    }
    const data = new FormData();
    Array.from(input.files).forEach((file) => data.append('files', file));
    context.setBusy((value) => ({ ...value, [`upload-${titleId}`]: true }));
    try {
      await context.request(`/study/titles/${encodeURIComponent(titleId)}/files`, { method: 'POST', body: data });
      input.value = '';
      await loadData();
      context.showToast('笔记已上传');
    } catch (error) {
      context.showToast(error.message, 'error');
    } finally {
      context.setBusy((value) => ({ ...value, [`upload-${titleId}`]: false }));
    }
  };

  const viewFile = async (file) => {
    setSelectedFile(file);
    setLoadingContent(true);
    setContent('');
    try {
      const rawUrl = `${apiBase}/study/files/${encodeURIComponent(file.id)}/content`;
      const response = await fetch(rawUrl);
      if (!response.ok) throw new Error('无法获取笔记内容');
      const md = await response.text();
      setContent(md);
    } catch (error) {
      context.showToast(error.message, 'error');
    } finally {
      setLoadingContent(false);
    }
  };

  if (!title) return null;

  return (
    <>
      <PageHero apiBase={apiBase} setApiBase={setApiBase} title={title.name} eyebrow="Notes Detail" description="查看和管理该主题下的所有笔记。" showToast={context.showToast} />
      <main className="detail-main">
        <div className="detail-sidebar">
          <button className="button ghost back-button" onClick={() => navigate('/notes')}>← 返回主题列表</button>

          <section className="panel upload-panel">
            <h3>上传笔记</h3>
            <form className="file-tools-vertical" onSubmit={uploadFiles}>
              <input type="file" name="files" accept=".md,.markdown,text/markdown" multiple aria-label="选择笔记文件" />
              <button className="button primary" type="submit" disabled={context.busy[`upload-${titleId}`]}>
                {context.busy[`upload-${titleId}`] ? '上传中...' : '上传笔记'}
              </button>
            </form>
          </section>

          <section className="panel files-panel">
            <h3>笔记列表</h3>
            <div className="file-list-vertical">
              {files.length ? files.map((file) => (
                <div
                  className={`file-item-mini ${selectedFile?.id === file.id ? 'active' : ''}`}
                  key={file.id}
                  onClick={() => viewFile(file)}
                >
                  <strong>{file.filename}</strong>
                  <span>{formatDate(file.created_at)}</span>
                </div>
              )) : <p className="empty-text">暂无笔记</p>}
            </div>
          </section>
        </div>

        <div className="detail-content">
          <section className="panel content-panel">
            {selectedFile ? (
              <>
                <div className="content-header">
                  <h2>{selectedFile.filename}</h2>
                  <p>{formatBytes(selectedFile.size)} · {formatDate(selectedFile.created_at)}</p>
                </div>
                <div className="markdown-body">
                  {loadingContent ? <p>正在加载内容...</p> : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  )}
                </div>
              </>
            ) : (
              <EmptyState message="请选择一个笔记" detail="从左侧列表中点击笔记即可查看详细内容。" />
            )}
          </section>
        </div>
      </main>
    </>
  );
}
