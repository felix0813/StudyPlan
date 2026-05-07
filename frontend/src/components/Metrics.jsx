import React from 'react';

export default function Metrics({ summary }) {
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
