import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Topbar from '../components/Topbar'
import EmptyState from '../components/EmptyState'
import '../styles/NoteDetail.css'

function formatDate(value) {
  if (!value) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function PageHero({ title, eyebrow, description, apiBase, setApiBase, showToast }) {
  return (
    <header className="hero page-hero detail-page-hero">
      <div className="page-title-container" style={{ maxWidth: '100%', padding: '0 var(--layout-padding)' }}>
        <Topbar apiBase={apiBase} setApiBase={setApiBase} showToast={showToast} />
        <div className="page-title">
          <button className="button ghost back-button-inline" type="button" onClick={() => window.history.back()}>
            返回主题列表
          </button>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
    </header>
  )
}

export default function NoteDetail({ apiBase, setApiBase, context }) {
  const { titleId } = useParams()
  const navigate = useNavigate()
  const [title, setTitle] = useState(null)
  const [files, setFiles] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const [content, setContent] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [filesCollapsed, setFilesCollapsed] = useState(false)
  const contentPanelRef = useRef(null)

  const loadData = useCallback(async () => {
    try {
      const titleData = await context.request(`/study/titles/${encodeURIComponent(titleId)}`)
      setTitle(titleData)
      const filesData = await context.request(`/study/titles/${encodeURIComponent(titleId)}/files`)
      setFiles(Array.isArray(filesData) ? filesData : [])
    } catch (error) {
      context.showToast(error.message, 'error')
      navigate('/notes')
    }
  }, [titleId, context, navigate])

  useEffect(() => {
    loadData()
  }, [loadData])

  const uploadFiles = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const input = form.querySelector('input[type="file"]')
    if (!input.files.length) {
      context.showToast('请选择至少一个笔记文件', 'error')
      return
    }

    const selectedFiles = Array.from(input.files)
    const existingNames = new Set(files.map((file) => file.filename))
    const duplicateNames = selectedFiles
      .map((file) => file.name)
      .filter((name, index, names) => existingNames.has(name) && names.indexOf(name) === index)
    const overwrite = duplicateNames.length > 0
    if (overwrite && !confirm(`以下文件已存在，是否覆盖？\n${duplicateNames.join('\n')}`)) {
      return
    }

    const data = new FormData()
    selectedFiles.forEach((file) => data.append('files', file))
    context.setBusy((value) => ({ ...value, [`upload-${titleId}`]: true }))
    try {
      await context.request(
        `/study/titles/${encodeURIComponent(titleId)}/files${overwrite ? '?overwrite=true' : ''}`,
        { method: 'POST', body: data },
      )
      input.value = ''
      await loadData()
      if (selectedFile && duplicateNames.includes(selectedFile.filename)) {
        setSelectedFile(null)
        setContent('')
      }
      context.showToast(overwrite ? '笔记已覆盖' : '笔记已上传')
    } catch (error) {
      context.showToast(error.message, 'error')
    } finally {
      context.setBusy((value) => ({ ...value, [`upload-${titleId}`]: false }))
    }
  }

  const viewFile = async (file) => {
    setSelectedFile(file)
    setLoadingContent(true)
    setContent('')
    contentPanelRef.current?.scrollIntoView({ block: 'start' })
    try {
      const response = await fetch(`${apiBase}/study/files/${encodeURIComponent(file.id)}/content`)
      if (!response.ok) throw new Error('无法获取笔记内容')
      const md = await response.text()
      setContent(md)
      requestAnimationFrame(() => {
        contentPanelRef.current?.scrollIntoView({ block: 'start' })
      })
    } catch (error) {
      context.showToast(error.message, 'error')
    } finally {
      setLoadingContent(false)
    }
  }

  const deleteFile = async (file, event) => {
    event.stopPropagation()
    if (!confirm(`确定删除“${file.filename}”？`)) return

    context.setBusy((value) => ({ ...value, [`delete-${file.id}`]: true }))
    try {
      await context.request(`/study/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
      if (selectedFile?.id === file.id) {
        setSelectedFile(null)
        setContent('')
      }
      await loadData()
      context.showToast('笔记已删除')
    } catch (error) {
      context.showToast(error.message, 'error')
    } finally {
      context.setBusy((value) => ({ ...value, [`delete-${file.id}`]: false }))
    }
  }

  const exportZip = async () => {
    context.setBusy((value) => ({ ...value, [`export-${titleId}`]: true }))
    try {
      const response = await fetch(`${apiBase}/study/titles/${encodeURIComponent(titleId)}/export`)
      if (!response.ok) {
        let message = '导出失败'
        try {
          const data = await response.json()
          message = data?.error || message
        } catch (error) {
          message = response.statusText || message
        }
        throw new Error(message)
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${title.name || 'study-notes'}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      context.showToast('导出完成')
    } catch (error) {
      context.showToast(error.message, 'error')
    } finally {
      context.setBusy((value) => ({ ...value, [`export-${titleId}`]: false }))
    }
  }

  if (!title) return null

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

      <main className={`detail-main ${filesCollapsed ? 'files-collapsed' : ''}`}>
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
              <button className="button primary" type="submit" disabled={context.busy[`upload-${titleId}`]}>
                {context.busy[`upload-${titleId}`] ? '上传中...' : '上传笔记'}
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={exportZip}
                disabled={context.busy[`export-${titleId}`] || files.length === 0}
              >
                {context.busy[`export-${titleId}`] ? '导出中...' : '导出 ZIP'}
              </button>
            </form>
          </section>
        </aside>

        <div className="detail-content">
          <section className="panel content-panel" ref={contentPanelRef}>
            {selectedFile ? (
              <>
                <div className="content-header">
                  <h2>{selectedFile.filename}</h2>
                  <p>
                    {formatBytes(selectedFile.size)} ·{' '}
                    {formatDate(selectedFile.updated_at || selectedFile.created_at)}
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
                message="请选择一篇笔记"
                detail="从右侧列表中点击笔记即可查看详细内容。"
              />
            )}
          </section>
        </div>

        <aside className={`detail-sidebar-right ${filesCollapsed ? 'collapsed' : ''}`}>
          <section className="panel files-panel">
            <button
              className="button ghost files-toggle"
              type="button"
              onClick={() => setFilesCollapsed((value) => !value)}
              aria-expanded={!filesCollapsed}
              aria-label={filesCollapsed ? '展开笔记列表' : '折叠笔记列表'}
              title={filesCollapsed ? '展开笔记列表' : '折叠笔记列表'}
            >
              {filesCollapsed ? '>' : '<'}
            </button>
            <h3>笔记列表</h3>
            <div className="file-list-vertical">
              {files.length ? (
                files.map((file) => (
                  <div
                    className={`file-item-mini ${selectedFile?.id === file.id ? 'active' : ''}`}
                    key={file.id}
                    onClick={() => viewFile(file)}
                  >
                    <div className="file-item-main">
                      <strong>{file.filename}</strong>
                      <span>{formatDate(file.updated_at || file.created_at)}</span>
                    </div>
                    <button
                      className="button danger file-delete-button"
                      type="button"
                      onClick={(event) => deleteFile(file, event)}
                      disabled={context.busy[`delete-${file.id}`]}
                    >
                      {context.busy[`delete-${file.id}`] ? '删除中' : '删除'}
                    </button>
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
  )
}
