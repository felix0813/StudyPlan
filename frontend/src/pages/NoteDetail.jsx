import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Topbar from "../components/Topbar";
import EmptyState from "../components/EmptyState";
import "../styles/NoteDetail.css";

// ... (formatDate, formatBytes 保持不变)

function PageHero({
  title,
  eyebrow,
  description,
  apiBase,
  setApiBase,
  showToast,
}) {
  return (
    <header className="hero page-hero detail-page-hero">
      <Topbar apiBase={apiBase} setApiBase={setApiBase} showToast={showToast} />
      <div className="page-title">
        {/* 返回按钮在标题左侧 */}
        <button
          className="button ghost back-button-inline"
          onClick={() => window.history.back()}
        >
          ← 返回主题列表
        </button>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}

export default function NoteDetail({ apiBase, setApiBase, context }) {
  // ... (state 和 hooks 保持不变)

  if (!title) return null;

  return (
    <>
      <PageHero
        apiBase={apiBase}
        setApiBase={setApiBase}
        title={title.name}
        eyebrow="Notes Detail"
        description="查看和管理该主题下的所有笔记。"
        showToast={context.showToast}
      />

      {/* Main 区域使用 Grid 布局，左右侧边栏分别在两侧 */}
      <main className="detail-main">
        {/* 左侧：上传组件 */}
        <aside className="detail-sidebar-left">
          <section className="panel upload-panel">
            <h3>上传笔记</h3>
            <form className="file-tools-vertical" onSubmit={uploadFiles}>
              <input
                type="file"
                name="files"
                accept=".md,.markdown,text/markdown"
                multiple
                aria-label="选择笔记文件"
              />
              <button
                className="button primary"
                type="submit"
                disabled={context.busy[`upload-${titleId}`]}
              >
                {context.busy[`upload-${titleId}`] ? "上传中..." : "上传笔记"}
              </button>
            </form>
          </section>
        </aside>

        {/* 中间：笔记具体内容 (宽度与标题视觉对齐) */}
        <div className="detail-content">
          <section className="panel content-panel">
            {selectedFile ? (
              <>
                <div className="content-header">
                  <h2>{selectedFile.filename}</h2>
                  <p>
                    {formatBytes(selectedFile.size)} ·{" "}
                    {formatDate(selectedFile.created_at)}
                  </p>
                </div>
                <div className="markdown-body">
                  {loadingContent ? (
                    <p>正在加载内容...</p>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {content}
                    </ReactMarkdown>
                  )}
                </div>
              </>
            ) : (
              <EmptyState
                message="请选择一个笔记"
                detail="从右侧列表中点击笔记即可查看详细内容。"
              />
            )}
          </section>
        </div>

        {/* 右侧：笔记列表 (悬挂) */}
        <aside className="detail-sidebar-right">
          <section className="panel files-panel">
            <h3>笔记列表</h3>
            <div className="file-list-vertical">
              {files.length ? (
                files.map((file) => (
                  <div
                    className={`file-item-mini ${selectedFile?.id === file.id ? "active" : ""}`}
                    key={file.id}
                    onClick={() => viewFile(file)}
                  >
                    <strong>{file.filename}</strong>
                    <span>{formatDate(file.created_at)}</span>
                  </div>
                ))
              ) : (
                <p className="empty-text">暂无笔记</p>
              )}
            </div>
          </section>
        </aside>
      </main>
    </>
  );
}
