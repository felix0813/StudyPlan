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
          <img src="./favicon.svg" alt="" />
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
