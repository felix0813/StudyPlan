import React from 'react';

export default function EmptyState({ message = '暂无内容', detail = '添加计划或笔记后，这里会显示进展。' }) {
  return (
    <div className="empty-state">
      <span>📚</span>
      <strong>{message}</strong>
      <p>{detail}</p>
    </div>
  );
}
