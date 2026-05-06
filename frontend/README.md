# StudyPlan 前端

这是使用原生 HTML + CSS + JavaScript 编写的个人学习工作台，直接调用后端 `/study` API。

## 功能

- 配置并保存 API 地址。
- 健康检查：展示 PostgreSQL 与 OSS 状态。
- 学习计划：创建/覆盖完整计划、查询计划、查看统计、获取下一个未完成任务、切换条目完成状态。
- 学习记录：创建标题、查询标题、重命名标题、删除标题。
- Markdown 文件：在指定标题下批量上传 `.md` / `.markdown` 文件，查询文件元数据。
- 响应式 UI：适合桌面和移动端个人学习使用。

## 本地预览

推荐通过 StudyPlan 后端同源访问，或用任意静态文件服务预览：

```bash
cd frontend
python3 -m http.server 5173
```

打开 `http://localhost:5173` 后，在页面顶部把 API 地址设置为后端地址，例如 `http://localhost:8080`。
