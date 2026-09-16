# 帮助文档中心

主站共享侧栏的“帮助文档中心”指向 `/tools/help`，文章使用 `/tools/help/{documentId}`。入口在项目页、全局工具和传入自定义工具的分集工作流中保持可用；不改变登录、项目访问或分享权限。

## 内容来源与中文编辑

- `deploy/new_html/help/sources/provenance.json` 固定开源文档提交、文件清单、来源校验和与操作手册校验和。
- `sources/manual/` 保留 2026-09-15 操作手册的 16 个正文章节，54 张图保留顺序。网页派生图位于 `public/assets/help/media/`；分享令牌、联系资料与账号配置经过脱敏，原始 Word 文件不写入公开源代码。
- `sources/repository/` 保留指定公开版本的全部 43 份 Markdown 原文；21 份英文正文在 `translations/` 中有完整中文阅读版。
- `appendices/` 是中文导读，原始许可、归属、结构化证据及设计组件脚本作为文本阅读，不执行。许可原文不是未经声明的中文法律替代条款。
- `sources/attachments/` 只保留公开文档的技术附件，脚本后缀为 `.js.txt`。18 张已有设计参考图只用于说明，不是线上界面状态证明。

历史默认值与能力说明附有版本提醒，不把旧文档当成当前在线状态。托管版功能说明不代表开源版自带本地节点服务。

## 维护与构建

修改中文稿后运行：

```bash
python deploy/scripts/build_help_catalog.py
python deploy/scripts/build_help_catalog.py --check
python -m pytest deploy/tests/test_help_catalog.py
```

生成的 `catalog.json` 是可复现的静态文档数据，不是运行时配置。与配图一起由现有 Vite 公共资源目录复制到构建的 `/assets/help/`，不增加服务器文件读取接口，也不依赖运行服务器上存在 Word 或源码仓库。普通构建和公开构建使用同一套文档资源。

帮助页按需加载，进入页面后一次读取目录及正文，支持中文和技术关键词全文搜索、分类、目录锚点、前后篇导航、直接链接、复制链接、图片延迟加载和失败重试。读取文档不触发生成、扣费、任务恢复或项目数据写入。

Markdown 使用 React 元素渲染，禁用原始 HTML，不加载远程图片，不执行示例代码；仅接受明确允许的链接形式。公开文档中的配置示例是供读者阅读的静态文字，不进入供应商运行配置或请求协议。

Markdown 阅读器固定使用 `react-markdown@10.1.0` 与 `remark-gfm@4.0.1`。新增 96 个锁定依赖声明为 MIT 或 ISC，安装包均含许可文件；既有依赖的版本、下载地址、完整性及许可证字段未变，原 55 项许可补充证据的包范围不变，仅在复核后更新锁文件摘要。这不代表完整 SBOM 或发布许可审查已经完成。

## 验证范围

前端覆盖共享导航、深链接、分类、正文搜索、加载失败、卸载取消、复制失败、配图失败、表格代码块、安全链接和重复标题。内容回归核对全量原文收录、中文覆盖、72 张本地图、文内链接及附件完整性。发布仍需普通/公开类型检查、测试、构建和源代码边界检查。

浏览器验收脚本 `node deploy/scripts/test_help_browser.mjs` 使用独立临时 Chromium 配置、本地构建和只读模拟响应，覆盖桌面、390px 窄屏、正文搜索、配图、刷新及目录定位。它不会使用真实账号或调用线上生成；窄屏检查等待侧栏动画结束，并校验阅读区域宽度，而不只检查横向溢出。

本次全量回归中的既有失败已在未修改的 `a0720e37` 基线上复现，不能据此宣称全套测试全绿：

- `VideoPage.externalUpload.test.tsx` 的 `JimengSeedance2` 时长断言期望 9 秒，现有模型校准逻辑实际返回 11 秒；属于视频工作区测试，不修改其运行逻辑。
- `check_route_contract.py` 的声音阶段静态断言仍要求 `forceReloadSlices('assets', 'characterVoices', 'script', 'audioTracks')`，基线实现已使用 `forceReloadSlicesQuiet('audioTracks')`；属于声音阶段契约维护，与新增帮助路由无关。

本功能不更新生产数据库，不改变后台配置，也不自动部署。发布时需要完整前端构建，不能只上传脚本块而遗漏静态目录。
