import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { normalizeBase, getDefaultApiBase } from '../services/api';

const API_BASE_KEY = 'studyplan_api_base';

export default function Topbar({ apiBase, setApiBase, showToast }) {
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
      <NavLink className="brand" to="/" aria-label="StudyPlan 首页">
        <span className="brand-mark" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title desc">
  <title id="title">StudyPlan 标识</title>
  <desc id="desc">带有学习计划勾选符号的渐变书本图标</desc>
  <defs>
    <linearGradient id="bg" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
      <stop stop-color="#4361ee"/>
      <stop offset="1" stop-color="#0fbc9d"/>
    </linearGradient>
    <linearGradient id="page" x1="19" y1="18" x2="48" y2="49" gradientUnits="userSpaceOnUse">
      <stop stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e9edff"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="18" fill="url(#bg)"/>
  <path d="M18 17.5c0-2 1.6-3.5 3.5-3.5H45c2.2 0 4 1.8 4 4v31.5c0 1.4-1.1 2.5-2.5 2.5h-25A3.5 3.5 0 0 1 18 48.5v-31Z" fill="#172033" opacity=".18"/>
  <path d="M16 16.5c0-2 1.6-3.5 3.5-3.5H43c2.2 0 4 1.8 4 4v31.5c0 1.4-1.1 2.5-2.5 2.5h-25A3.5 3.5 0 0 1 16 47.5v-31Z" fill="url(#page)"/>
  <path d="M23 21h17M23 29h17M23 37h10" stroke="#4361ee" stroke-width="4" stroke-linecap="round"/>
  <path d="m35.5 42.5 4.5 4.5 10-12" fill="none" stroke="#0fbc9d" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
        </span>
        <span>
          <strong>StudyPlan</strong>
          <small>学习小站</small>
        </span>
      </NavLink>
      <div className="page-nav" aria-label="页面导航">
        <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/" end>总览</NavLink>
        <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/plan">学习计划</NavLink>
        <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to="/notes">学习笔记</NavLink>
      </div>
      <div className="api-config" aria-label="服务配置">
        <label htmlFor="apiBase">服务地址</label>
        <input id="apiBase" type="url" placeholder="http://localhost:8080" autoComplete="off" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button className="button ghost" type="button" onClick={saveApiBase}>保存</button>
      </div>
    </nav>
  );
}
