# 创剧自由画布

自由创作前端。它以独立 Vite 应用构建到 `studio/dist`，由现有 FastAPI 服务在
`/studio/` 下托管；主站 `/projects/:projectId/ep/:episodeId/canvas` 路由负责携带
项目与分集参数跳转。

Studio 不写入正式剧本、分镜或视频片段表。画布快照按 `project_id + episode_id`
存入现有 Canvas 表，生成文件绑定到 `episode` 实体，并复用主站运行时模型、
积分和任务通知服务。

```powershell
npm install
npm run test
npm run build
```
