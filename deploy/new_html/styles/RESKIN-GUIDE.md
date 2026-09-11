# 创剧 frontend visual system

仓库根 `DESIGN.md`（暖白 + 紫罗兰标准）是视觉来源，`design-tokens.css` 与
`tailwind.config.cjs` 是实现契约。创作端、后台和弹窗必须复用同一套令牌，
不得在业务组件中新增独立主题。历史 `n*`、`b*` 等令牌名保留，值已重映射。

## 核心视觉

- 页面画布：暖白 `#F4F4F1`（`bg-n20`）；卡片与表面：白色 `#ffffff`（`bg-n0`）
- 主文字：`#17171C`（n800）；正文 `#3A3A44`（n500）；次级 `#6A6A74`（n300）
- 主操作：紫罗兰 `#5B49F0`（primary），悬停 `#4C3BD6`，大 CTA 可用渐变 `#5B49F0→#7A5BFF` + 紫光晕
- 边框：`#E5E5E0`（n40），悬停边框 `#9A9AA2`（n90）；占位文字 `#9A9AA2`
- 语义色：角色/进行=紫 `#5B49F0`、场景/成功=绿 `#12B76A`、道具/时间码=橙 `#FF6A3D`、
  信息=蓝 `#3B7BE5`、草稿/警示=琥珀 `#D9822B`、错误=红 `#E5533C`；tint 底 + 实色字
- 深色表面仅限三处：侧边栏 / 视频播放器 / 数据表深色表头（`bg-n900` = `#141419`，
  悬停 `bg-n700`，分隔 `border-n600`；后台 AdminSidebar 即深色侧栏范式）

兼容旧组件的 `n*`、`b*`、`p*` 等 Tailwind 名称已经映射到上述色板。新组件优先
使用语义类：`primary`、`success`、`warning`、`danger`。

## 字体与层级

- 标题字体：`Sora`（`font-display`，700–800，负字距）；中文回退 Noto Sans SC / 系统
- 正文与按钮：`Noto Sans SC`（`font-sans`，400–600）
- 编号 / 时间码 / 英文小标：`Space Mono`（`font-mono`，加宽字距，常配大写）
- 剧本、提示词等长篇可读内容：`Times New Roman` 负责英文和数字，中文回退系统字体（`font-document`）；不要使用等宽代码字体。
- Sora 与 Space Mono 通过 `@fontsource` 构建期打包（见 index.tsx），不依赖外网 CDN
- 中英双语标签是身份特征：`中文 · English`（英文可用 `.ui-eyebrow` 或 font-mono）
- 页面标题 22–24px；卡片标题 15px；正文 13–14px；微标签 10–11px

## 形状、边界与阴影

- 控件（按钮/输入/chip）：9px 圆角（`rounded`）；小件 6px（`rounded-sm`）
- 卡片和弹窗：14–16px（`rounded-lg` / `rounded-xl`）；大容器 20px（`rounded-2xl`）
- 头像、状态点可使用圆形；状态药丸 `rounded-full`
- 卡片：`1px solid #E5E5E0` + `shadow-card`（0 6px 20px @5%）；悬停可升 `shadow-hover`
- 重要浮层：`shadow-atlas`（0 24px 70px @18%）；主按钮光晕 `shadow-glow`（紫）

`rounded-xl`、`rounded-2xl`、`rounded-3xl` 在全局契约中限制为 14–20px 体系，
防止历史组件出现失控圆角。

## 基础控件

- 输入框、文本域、下拉框统一白底、`#E5E5E0` 边框和 9px 圆角
- 聚焦态使用 `#5B49F0` 边框及 `rgba(91,73,240,.16)` 焦点环
- 主按钮使用 `bg-primary`，悬停 `#4C3BD6` + 紫光晕；禁用态降饱和、无阴影
- 筛选 chip：未选 白底 n40 边 n300 字；选中 `bg-primary-light` + `text-primary` + primary 边
- 卡片优先使用 `ui-card`；无阴影表面使用 `ui-surface`
- 小标题或分类标签使用 `ui-eyebrow`（已自动走 Space Mono）
- 空态：`border-2 border-dashed border-n60` + 紫 tint 图标块，悬停整体转紫

## 弹窗

所有新弹窗必须采用以下结构（遮罩为深色 `rgba(20,20,25,.55)` + blur）：

```tsx
<div className="app-modal-backdrop fixed inset-0 ...">
  <div
    role="dialog"
    aria-modal="true"
    aria-label="弹窗标题"
    className="app-modal-surface ..."
  >
    <header className="app-modal-header">...</header>
    <div className="app-modal-body">...</div>
    <footer className="app-modal-footer">...</footer>
  </div>
</div>
```

历史 Tailwind 浮层由全局兼容选择器统一遮罩、圆角、边框、阴影和动效；
修改到对应组件时应补齐上述语义类和无障碍属性。

## 响应式

- 桌面断点：992px；平板：768px；手机：479px
- 小屏弹窗自动转为底部面板，内容区域必须允许滚动
- 尊重 `prefers-reduced-motion`

## 禁止事项

- 不得引入本色板之外的颜色；新语义先映射到既有六组语义色
- 不得将橙 / 琥珀 / 绿等次级色用于全站主操作（主操作只有紫罗兰）
- 深色表面不得超出侧边栏 / 播放器 / 深色表头三个场景
- 不得在组件内硬编码阴影与十六进制色值（用 token / 语义类）
- 不得为了换肤改动状态、接口、积分、任务、历史版本或生产工作流逻辑
