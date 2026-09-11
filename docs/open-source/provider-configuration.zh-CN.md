# Ovideo 第三方 API 平台配置教程

本文按当前服务端供应商注册表说明在线 API。平台文档、模型 ID、价格、地区、额度和接口版本会变化；配置前必须再次查阅平台官方页面。本文不代替第三方服务条款，也不代表发行方为任何平台提供支持或担保。

## 1. API 平台接入流程

接入平台时，请完成以下配置与验证：

1. 在平台官方网站注册独立的组织/项目，不共用个人日常账号；
2. 完成平台要求的实名、企业认证、地区选择和计费开通；
3. 只启用实际需要的模型和 API；
4. 创建应用专用 Key，不使用主账号永久 Key；
5. 如平台支持，限制 Key 的模型、IP、来源、权限和月度预算；
6. 记录 Key 的所有者、用途、创建时间、到期/轮换时间和撤销流程，但不记录明文；
7. 在 Ovideo 后端管理后台创建供应商卡，核对 `provider`、`endpoint`、`model_name` 和计费通道；
8. 先做不计费健康检查，再做最小成本真实生成；
9. 检查任务记录保存的“实际供应商 + 实际模型”与请求一致；
10. 设置额度、费用、失败率和异常地域告警；
11. 把轮换和故障切换在测试环境演练一遍。

永远不要把供应商 Key 放入 `VITE_*`、浏览器、移动端、URL 查询参数、提示词、日志或 Git。数据库保存 Key 时必须配置有效的 `API_CONFIG_ENC_KEY`；Base64 编码不算加密。

## 2. 后台供应商卡填写顺序

进入管理员后台的 API 厂商配置页面。每张卡按顺序填写：

1. **名称 `name`**：例如“MiniMax 国内站 - 视频与语音 - 生产”；
2. **供应商 `provider`**：选择代码支持的精确标识；
3. **Endpoint `endpoint`**：完整 HTTPS 地址，核对国内/国际、按量/套餐；
4. **API Key `api_key`**：只在后端输入；
5. **默认模型 `model_name`**：精确 API 模型 ID；
6. **模型绑定 `model_bindings`**：把每种操作绑定到正确模型；
7. **类别 `category`**：`text`、`image`、`video` 或 `audio`；
8. **代理模式 `proxy_mode`**：默认 `direct`；只有确需可信代理时才选 `custom`；
9. **自定义代理 `custom_proxy`**：仅自定义代理模式填写；
10. **请求模板 `request_template`**：只填适配器明确支持的扩展字段；
11. **额外 Headers `headers`**：通常留空；不要重复保存认证 Key；
12. **启用 `enabled`**：完成测试后再开启。

如果同一平台有国内站/国际站、按量/套餐、生产/测试、多 Key 轮换，请分别建卡，不要在一张卡里混用不同签发方的 Key 和 Endpoint。

### 2.1 十二个后台字段复核表

| 字段 | 必须回答的问题 | 错误配置的典型后果 | 安全验证 |
| --- | --- | --- | --- |
| `name` | 名称是否明确写出平台、站点、用途、环境和计费通道？ | 运维人员轮换错卡、把测试卡启用到生产 | 名称不含完整 Key、手机号、内部 IP 或客户名 |
| `provider` | 是否是代码注册表中的精确 ID？ | 环境变量派生、路由和健康检查落到错误适配器 | 从后台目录选择，不手工创造近似拼写 |
| `endpoint` | 是否由 Key 签发方提供？地域、版本、按量/套餐是否一致？ | 401、404、跨区、错误计费，或把 Key 交给第三方 | 生产 HTTPS；不得含用户名、密码、片段或控制字符；解析地址符合出站策略 |
| `api_key` | 是否是本应用、此环境、此平台专用 Key？ | 泄露影响面扩大，撤销时牵连其他系统 | 只写入服务端；读取接口只返回掩码/是否已配置；浏览器和日志中搜索不到 |
| `model_name` | 是否是 API 接受的精确模型 ID，而不是营销名称？ | 下拉菜单正确但实际请求 404，或供应商自动降级到别的模型 | 用最小真实请求核对响应/任务中的实际模型字段 |
| `model_bindings` | 每个 operation、scope 是否唯一且与能力匹配？ | 生成结果标错模型、流程与自由创作互相覆盖 | 分别测试 `workflow` 和 `studio`，历史记录保存请求与解析后的实际值 |
| `category` | 是否与真实能力一致？ | 管理后台健康检查发送错误类型的探测 | 文本、图片、视频、音频分别走对应的最小请求 |
| `proxy_mode` | 是否真的需要代理？ | 额外泄露面、出口不稳定或地域变化 | 默认 `direct`；代理模式变更必须有变更单和回滚 |
| `custom_proxy` | 代理是否由部署组织控制并审计？ | SSRF、凭据和素材被中间人读取 | 只允许管理员配置；URL 不含凭据；生产私网代理需要显式安全例外 |
| `request_template` | 每个扩展键是否由适配器明确读取？ | 无效字段造成误判，或危险参数覆盖计费/身份 | 只保留有文档和测试的字段；导出后人工复核 |
| `headers` | 是否确有平台文档要求？ | 请求走私、Host/长度覆盖、重复认证 | 拒绝换行/NUL、连接级头和 HTTP framing 头；通常保持空对象 |
| `enabled` | 是否已经完成健康和真实生成两类验证？ | 未验证 Key 进入生产流量 | 先保存为禁用，验证通过后再启用，并保留可立即禁用的旧卡 |

### 2.2 历史模型配置的兼容规则

旧卡片可能只有 `model_name`，也可能有未填写 `scope` 的 `model_bindings`。维护和导入时应遵守：

- 有效的 `model_bindings` 优先于旧的 `model_name`；不要用旧字段覆盖已经分别配置的模型。
- 只有 `model_name` 时，保留填写的实际模型或部署 ID，不能因补齐后台预设选项而替换成预设 ID。明确支持的操作简称仍映射到对应默认模型。
- 未填写 `scope` 的历史绑定对 `workflow` 和 `studio` 均生效；已经明确填写范围的绑定分别保留。新配置建议总是显式填写范围。
- 后台为编辑方便补齐的预设选项不代表另一张启用卡的凭据归属；必须分别核对实际运行时的模型、Endpoint 和 Key 来源。

修改这些兼容逻辑时，运行 `deploy/tests/test_legacy_api_model_bindings.py` 和 `deploy/scripts/check_api_config_runtime_loader.py`，覆盖自定义 ID、两种使用范围、不同操作卡片、加载失败保留旧值以及禁用后的环境回退。测试使用假配置，不调用付费供应商或真实数据库。

### 2.3 Endpoint、模型和 Key 必须视为一个不可拆分的四元组

任何供应商卡都要同时记录并验证四项：Key 的签发主体、Endpoint 的所有主体、API 协议/认证格式、模型 ID。只要其中一项来自另一个站点或网关，就不是同一个配置。

例如，某网关声称兼容 OpenAI `chat/completions`，只表示请求形状可能兼容，不代表 Google、DeepSeek、MiniMax 或 OpenAI 官方 Key 可以直接用于该网关。反过来，网关签发的 Key 也不能填入上游官方 Endpoint。配置界面的展示名不构成供应商真实性证明，健康接口返回 200 也不证明实际模型正确。

### 2.4 公开发布版的出站安全约束

- 生产 Endpoint 默认必须为 HTTPS，并解析到公网地址；回环、私网、链路本地和云元数据地址默认拒绝。
- 生产自定义代理默认也必须解析到公网地址。确需企业私网网关时，由部署者显式启用安全例外并记录到期时间。
- 所有供应商请求禁用自动重定向；3xx 应视为需要重新核验最终官方地址的配置错误。
- DNS 校验和实际连接之间仍可能发生 DNS rebinding。高安全部署还应在出口防火墙或代理层限制目标域名/IP，并监控解析变化。
- 自定义 Headers 最多 64 个；禁止控制字符以及 `Host`、`Content-Length`、`Transfer-Encoding`、`Connection` 等 framing/连接头。
- 健康检查错误和第三方响应必须脱敏；不得向普通用户返回原始响应正文、Endpoint 内部路径、代理凭据或异常堆栈。

### 2.5 保存前、启用前、上线后的三次检查

保存前检查字段形状：provider、HTTPS Endpoint、模型 ID、Key 来源、计费通道、scope、operation。启用前检查最小真实能力：输入格式、输出 MIME、异步终态、错误映射、实际模型、一次扣费。上线后检查运行行为：失败率、429、费用、延迟、异常地域、模型标签、重试幂等和日志脱敏。

三次检查不能合并成一次“测试连接”。连接成功只证明某个请求得到响应；它不证明内容生成、模型一致、费用正确、用户错误可理解或失败不会重复扣费。

### 2.6 公开版模型能力清单不是供应商模型列表

登录后的前端通过 `GET /api/video/capabilities` 读取当前公开版能力清单。该接口只返回公开版在线供应商能力，不返回节点地址、Agent 标识、GPU、工作流或 ComfyUI 路由；接口需要有效用户会话，不能作为匿名基础设施探针。

清单中的每个模型都必须具备 `provider`、实际 `model_name`、输入模式、参数规则、`available` 和 `unavailable_reason`。后台未配置 Key、卡片未发布或健康检查失败时，模型仍可在前端以灰色展示，但不能提交任务，并应向鼠标悬停用户说明原因。“灰色可见”只表示产品目录保留这个选项，不表示账户已经开通、供应商当前支持该 ID，或真实计费请求一定成功。

公开版固定返回 `comfyui_available=false`。这不是禁止用户使用自己的 ComfyUI，而是表示发行包没有 Ovideo 本地执行实现。使用者自行实现并审计连接器后，必须自己扩展能力清单和前端适配；不得通过复制私有入口或伪造可用状态绕过边界。

管理员每次修改卡片后，应依次验证：普通用户能读取清单、匿名请求得到 401、禁用模型仍显示且含原因、启用模型的标签与真实请求记录一致、一次最小生成保存了供应商返回的任务 ID 和实际模型。健康检查与真实生成必须分别记录。

## 3. Google Gemini

- 官方 Key 指南：<https://ai.google.dev/gemini-api/docs/api-key>
- Key 控制台：<https://aistudio.google.com/app/apikey>

### 3.1 创建凭据

1. 登录 Google AI Studio；
2. 选择或导入正确的 Google Cloud 项目；
3. 启用 Gemini API 所需权限；
4. 创建 API Key；
5. 按 Google 当前政策选择/迁移到更安全的授权 Key；
6. 限制 API 和来源，并设置预算告警；
7. 只在 Ovideo 后端保存。

Google 官方明确要求密钥不得提交 Git，也不得放在生产客户端。泄露后应先创建替代 Key、验证新 Key，再撤销旧 Key并审计用量。

### 3.2 `gemini-text`

- `provider`：`gemini-text`；
- 类别：`text`；
- Key 环境名：`GEMINI_TEXT_API_KEY`；
- 模型示例：`gemini-2.5-flash`；
- 当前适配器操作：OpenAI-compatible `chat/completions`。

关键区别：当前注册表中的 Gemini 文本默认 Endpoint 是兼容网关，不是 Google 原生 `generativelanguage.googleapis.com` 地址。Google 官方 Key 不能自动等同于网关 Key。部署者必须先确定自己使用的是 Google 官方端点还是第三方兼容网关，并确保“Key 签发方、Endpoint 所有者、认证格式、模型 ID”四项完全对应。

若用第三方兼容网关：

- 阅读网关自己的隐私、保留、计费和子处理方条款；
- 使用网关签发的 Key；
- 不要把 Google Key 交给不受信任网关；
- 核对网关是否真正支持配置的模型 ID。

### 3.3 `gemini-image`

- `provider`：`gemini-image`；
- 类别：`image`；
- Key 环境名：`GEMINI_IMAGE_API_KEY`；
- 模型：`gemini-2.5-flash-image` 或当前注册表列出的 `gemini-3.1-flash-image-preview`；
- 当前适配器操作：`models/{model}:generateContent`。

预览模型可能变更、限区或下线。不要只看 UI 展示名称；保存后做真实图片生成，确认响应格式、MIME、额度扣减和失败映射。

### 3.4 Gemini 验证

1. 后台健康检查显示 Key 已配置；
2. Endpoint 主机与 Key 签发方对应；
3. 文本调用返回预期模型；
4. 图片调用返回实际图片且媒体类型正确；
5. 浏览器网络面板看不到 Key；
6. 服务端日志只记录供应商、模型、状态码和脱敏请求 ID。

### 3.5 Gemini 参数和故障定位

`GEMINI_TEXT_API_KEY` 与 `GEMINI_IMAGE_API_KEY` 可以由同一 Google 项目签发，但生产推荐按能力拆分，便于单独限额和撤销。若使用 Google 原生图片接口，Endpoint 是 API 基址，适配器再拼接 `models/{model}:generateContent`；不要把完整操作路径重复写入基址。文本配置当前是 OpenAI-compatible 适配方式，必须使用真正支持该协议的 Endpoint 和该 Endpoint 所有者签发的 Key。

- 400：先检查请求字段、参考图 MIME、大小、模型能力和 API 版本；不要把所有 400 都解释成提示词违规。
- 401/403：检查 Key 是否属于当前项目、API 是否启用、限制条件和 Endpoint 所有者是否一致。
- 404：检查模型是否在该 API 版本和地域可用，以及是否把完整路径重复拼接。
- 429：区分每分钟限额、每日额度、并发和计费未开通；退避前先保证同一业务请求不会重复创建收费任务。
- 响应成功但无图片：检查候选内容、内联数据、MIME 和安全过滤结果，不能把空结果保存为成功。

Google 官方 Key 文档强调服务端使用和凭据限制。部署者仍需在发布当天复核官方 Key 文档，因为支持的 Key 类型和控制台流程可能变化。

## 4. DeepSeek

- 官方文档：<https://api-docs.deepseek.com/api/deepseek-api>
- Key 控制台：<https://platform.deepseek.com/api_keys>

### 4.1 后台字段

- `provider`：`deepseek`；
- 类别：`text`；
- `endpoint`：官方常用基址 `https://api.deepseek.com`，以官方当前文档为准；
- Key 环境名：`DEEPSEEK_API_KEY`；
- Endpoint 环境名：`DEEPSEEK_ENDPOINT`；
- 模型覆盖：`DEEPSEEK_MODEL_REASONER`、`DEEPSEEK_MODEL_CHAT`；
- 当前操作绑定：`deepseek-reasoner`、`deepseek-chat`；
- 当前注册表默认映射：Reasoner → `deepseek-v4-pro`，Chat → `deepseek-v4-flash`。

模型 ID 可能是平台或兼容网关特定值。若官方控制台显示的模型与当前注册表不同，必须以实际 API 返回为准更新绑定并测试，不要修改显示名来假装兼容。

### 4.2 配置步骤

1. 在 DeepSeek 平台创建应用专用 Key；
2. 设置充值/预算和调用告警；
3. 新建 `deepseek` 卡；
4. 填写 HTTPS Endpoint；
5. 填 Key；
6. 为 Reasoner 和 Chat 分别建立模型绑定；
7. 默认直连；如必须代理，单独审计代理；
8. 先禁用保存，执行连接测试；
9. 用不含隐私的短提示词做最小真实请求；
10. 核对返回 `model` 和任务记录后启用。

### 4.3 常见错误

- 401：Key 错误、撤销、签发平台与 Endpoint 不匹配；
- 402/余额不足：充值或套餐问题，不要无限重试；
- 404/模型不存在：模型 ID 或接口版本错误；
- 429：并发/速率/余额限制，应退避并限制 Worker；
- 超时：先核对网络和 Endpoint，再检查代理，不能通过关闭 TLS 验证解决。

### 4.4 DeepSeek 参数核对

当前 Ovideo 的 `deepseek-reasoner`、`deepseek-chat` 是业务 operation；`DEEPSEEK_MODEL_REASONER`、`DEEPSEEK_MODEL_CHAT` 的值才是发送给平台的模型 ID。注册表中的默认映射反映当前开发树，不代表 DeepSeek 官方永久存在同名模型。官方模型列表会更新且旧别名可能停止服务；使用官方 Endpoint 时，必须在部署当天从 [DeepSeek 官方文档首页](https://api-docs.deepseek.com/) 和模型列表重新确认精确 ID，再通过环境覆盖或后台绑定写入。使用兼容网关时，必须使用网关自己的 Key，并把卡片名称标明“兼容网关”。

验证推理与聊天两条绑定时，要分别检查：请求中的 `model`、流式和非流式响应、思考字段兼容性、最大输出长度、取消连接、429 退避和用户可见错误。一个 operation 成功不代表另一个 operation 已开通。

## 5. 火山引擎方舟：Doubao Seedream 图片

- 官方文档入口：<https://www.volcengine.com/docs/82379/>；从该目录进入当日的图片生成 API、视频生成 API、模型列表和计费页，不依赖可能迁移的旧文章编号。
- 方舟控制台：<https://console.volcengine.com/ark>

### 5.1 计费通道不能混用

当前代码区分：

- 按量 Endpoint：`https://ark.cn-beijing.volces.com/api/v3/images/generations`；
- Agent Plan Endpoint：`https://ark.cn-beijing.volces.com/api/plan/v3/images/generations`。

按量 Key、Agent Plan Key、Endpoint 和模型 ID 必须成套。不能只改 Endpoint 而沿用不对应的 Key 或模型。

### 5.2 后台字段

- `provider`：`doubao`；
- 类别：`image`；
- 主 Key：`ARK_API_KEY`；
- 主模型：`ARK_MODEL`（使用环境覆盖时）；
- 按量当前默认模型：`doubao-seedream-5-0-lite-260128`；
- Agent Plan 当前默认模型：`doubao-seedream-5.0-lite`；
- 另有当前注册表列出的 Pro 模型绑定。

### 5.3 配置步骤

1. 在方舟控制台选择正确地域；
2. 开通图片模型和对应计费方式；
3. 创建与该通道对应的 Key；
4. 新建 `doubao` 卡并在名称中写明“按量”或“Agent Plan”；
5. 选择完全对应的 Endpoint；
6. 选择对应模型 ID；
7. 保存前再次核对通道；
8. 用低分辨率、单张图片做真实测试；
9. 检查请求失败时没有自动切到错误计费通道；
10. 确认任务历史保存实际模型。

### 5.4 Seedream 参数核对

- `ARK_API_KEY` 是服务端凭据；Agent Plan 若使用独立 Key，应在对应卡或操作级字段中显式配置，不要靠名称推断通道。
- `ARK_MODEL`/绑定模型是精确请求 ID；带日期的 ID、别名和营销名称不可互换。
- `size` 必须满足当前模型的最小像素、宽高比和上限；适配器的归一化不能代替阅读平台限制。
- 参考图必须先经过媒体授权、远程 URL 安全检查、字节上限和像素上限；供应商接受 URL 不等于 Ovideo 可以读取任意 URL。
- 异步 Agent Plan 任务要保存任务 ID并轮询明确终态；HTTP 超时不能直接判定“任务未创建”。
- 内容安全错误只能返回受控说明；日志不得保存完整私密提示词或第三方原始错误正文。

## 6. 火山引擎方舟：Seedance 视频

官方文档入口同上，具体视频模型、参数和计费请以方舟当前文档为准。

### 6.1 支持的操作绑定

当前注册表：

- `agent_plan` → `doubao-seedance-1.5-pro`；
- `standard` → `doubao-seedance-2-0-260128`；
- `fast` → `doubao-seedance-2-0-fast-260128`；
- `mini` → `doubao-seedance-2-0-mini-260615`。

当前 Endpoint：

- 按量：`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`；
- Agent Plan：`https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks`。

### 6.2 环境字段

- 主 Key：`SEEDANCE_API_KEY`，缺失时当前代码可能回退 `ARK_API_KEY`；
- 操作模型：`SEEDANCE_MODEL_AGENT_PLAN`、`SEEDANCE_MODEL_STANDARD`、`SEEDANCE_MODEL_FAST`、`SEEDANCE_MODEL_MINI`；
- 操作 Key：`SEEDANCE_AGENT_PLAN_API_KEY`、`SEEDANCE_STANDARD_API_KEY`、`SEEDANCE_FAST_API_KEY`、`SEEDANCE_MINI_API_KEY`；
- 操作 Endpoint：对应的 `SEEDANCE_<OPERATION>_ENDPOINT`。

生产建议每个计费通道显式配置 Key，不依赖隐式回退。否则一个 Key 变更可能意外影响多个模型。

### 6.3 配置与验证

1. 分别确认 1.5 Pro Agent Plan 和 2.0 按量权限；
2. 每个通道建立独立卡或独立操作绑定；
3. 核对首尾帧/全能参考等模式所需输入数量；
4. 核对比例、分辨率、时长、音频参数是否被该具体模型支持；
5. 以 1 个最小视频测试每个操作；
6. 等待异步任务完成并核对查询 Endpoint；
7. 检查前端显示模型与实际供应商返回一致；
8. 检查失败不会隐藏模型，而是展示明确不可用原因；
9. 检查重试不会重复扣费或重复创建任务。

### 6.4 Seedance 输入模式和参数核对

`agent_plan`、`standard`、`fast`、`mini` 是 Ovideo 的绑定 operation，不是可以随意发送给平台的模型名。每个 operation 应显式绑定模型、Key 和 Endpoint。1.5 Pro 的首尾帧、2.0 系列的全能参考/首尾帧等能力必须按实际模型文档限制输入数量，不能把前端显示的素材槽位数量当作平台能力证明。

测试以下场景：无参考纯文本、单首帧、首尾帧、多参考（模型支持时）、参考音频（模型支持时）、横竖比例、每种分辨率、每种时长、带/不带水印、音频开关和提示优化。响应完成后用媒体探针核对真实时长、尺寸、编码和是否含音轨；供应商接受“6 秒”参数但返回 5 秒仍应记录为能力/适配问题，而不是只看任务成功状态。

## 7. MiniMax / Hailuo / Speech / Music / M3

- 国内 API 概览：<https://platform.minimaxi.com/docs/api-reference/api-overview>
- 国内控制台：<https://platform.minimaxi.com/console/personal-info>
- 国际站：<https://platform.minimax.io/>

### 7.1 国内站与国际站

- 国内常用 Endpoint：`https://api.minimaxi.com/v1`；
- 国际常用 Endpoint：`https://api.minimax.io/v1`。

国内 Key 不能假设可用于国际 Endpoint，国际 Key 也不能假设可用于国内 Endpoint。卡片名称必须写明站点。

### 7.2 后台字段

- `provider`：`minimax`；
- 能力：`video`、`audio`、`text`；
- 主 Key：`MINIMAX_API_KEY`；
- `MINIMAX_GROUP_ID`：仅部分 TTS、音色设计/克隆或旧接口需要；
- `MINIMAX_PROVIDER_ACCESS_MODE`：例如 `standard` 或 `token_plan`；
- 视频：`MiniMax-Hailuo-2.3`、`MiniMax-Hailuo-2.3-Fast`；
- 语音：`speech-2.8-hd`、`speech-2.8-turbo`；
- 音乐：`music-2.6`；
- 文本：`MiniMax-M3`。

操作模型覆盖：

- `MINIMAX_MODEL_M3`；
- `MINIMAX_MODEL_MUSIC`；
- `MINIMAX_MODEL_SPEECH_HD`；
- `MINIMAX_MODEL_SPEECH_TURBO`。

### 7.3 Group ID 与 Token Plan

`group_id` 和 `provider_access_mode` 位于 `request_template` 扩展字段：

```json
{
  "group_id": "<FILL_ME_ONLY_IF_REQUIRED>",
  "provider_access_mode": "standard"
}
```

如果使用 Token Plan 且官方接口明确不需要旧 GroupId，应选择 `token_plan` 并不要随意附加 GroupId。GroupId 不是 API Key，也不能代替认证。

### 7.4 配置建议

同一 Key 可以覆盖多种能力，但生产上应通过 `model_bindings` 明确每个操作。视频、语音、音乐和文本的测试成本不同；健康检查不能代替真实生成。真实测试必须选择最低可接受成本并记录供应商请求 ID。

视频重点核对时长、分辨率、首尾帧输入和实际返回时长；语音重点核对音色权限、文本长度、语言和输出格式；音乐重点核对歌词/风格参数及内容权利。

### 7.5 MiniMax 各能力验证

- Hailuo 视频：验证 `MiniMax-Hailuo-2.3` 与 Fast 卡片分别显示和记录；首帧、尾帧、时长、分辨率、提示优化以及异步查询/下载都要独立测。官方图生视频文档示例可能使用 6 秒和 1080P，但可选值仍以当前模型文档和账户权限为准。
- Speech：验证 `speech-2.8-hd` 与 `speech-2.8-turbo`、同步/异步路径、文本长度、语言、音色 ID、速度、音量、音高和输出编码。声音克隆/设计需确认授权和删除流程。
- Music：验证 `music-2.6` 的歌词、风格描述、时长/格式限制和内容政策；生成音频成功后检查 MIME、可播放性和任务来源记录。
- M3 文本：验证 Anthropic/OpenAI-compatible 协议路径与当前 Endpoint 匹配。Endpoint 中已经包含 `/anthropic/` 时不能再按 OpenAI 路径重复拼接。
- Group ID：只有官方接口要求时才传；Token Plan 模式应按平台规则省略旧 GroupId。401/1004 类错误先核对站点和 Key，不能通过在多个字段重复放 Key 解决。

MiniMax 任务是典型的“提交成功、查询失败、下载失败”三阶段流程。三阶段必须保存同一供应商任务 ID；查询超时后先恢复查询，不应重新提交；下载失败只重试下载，不应重新生成。

## 8. 阿里云 Model Studio / DashScope

- 官方快速开始：<https://www.alibabacloud.com/help/en/model-studio/first-api-call-to-qwen>
- 控制台：<https://bailian.console.aliyun.com/>

### 8.1 账号与 Key

1. 登录阿里云并开通 Model Studio；
2. 选择正确地域和 Workspace；
3. 创建 API Key；
4. 如控制台支持，限制可调用模型；
5. 记录 Workspace/地域，但不要把 Key 写入文档；
6. 设置费用和限额告警。

不同地域可能使用不同 Endpoint 或 Workspace 域名。Key、Workspace、地域和 Endpoint 必须一致。

### 8.2 后台字段

- `provider`：`dashscope`；
- 类别：`video`；
- 主 Key：`DASHSCOPE_API_KEY`；
- 当前默认视频合成 Endpoint：`https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`；
- 支持的绑定包括 Wan 2.6、Kling、Vidu、HappyHorse。

当前注册表操作与默认模型：

- `wan26` → `wan2.6-i2v`；
- `kling-standard` → `kling/kling-v3-video-generation`；
- `kling-omni` → `kling/kling-v3-omni-video-generation`；
- `vidu-reference-q3-mix` 等 Vidu reference-to-video；
- `vidu-startend-q3-pro` 等 Vidu start/end-to-video；
- `happyhorse` → `happyhorse-1.0-r2v`。

每个操作可用 `DASHSCOPE_<OPERATION>_API_KEY`、`DASHSCOPE_<OPERATION>_ENDPOINT` 和相应模型环境变量覆盖。操作中的连字符转换为下划线。

### 8.3 验证

不要因为同一 Key 能列出模型就假设所有视频模型都有权限。每个绑定至少做一次真实测试，核对输入模式、参考图数量、分辨率、时长、异步查询和实际模型标签。

### 8.4 DashScope 操作级参数

`DASHSCOPE_API_KEY` 是主 Key。任一操作需要独立 Key、Endpoint 或模型时，使用 `DASHSCOPE_<OPERATION>_API_KEY`、`DASHSCOPE_<OPERATION>_ENDPOINT` 和 `DASHSCOPE_MODEL_<OPERATION>` 形式的代码支持字段；operation 中的连字符转为下划线并大写。不要自行创造环境名，先以后台供应商目录返回的字段为准。

Wan、Kling、Vidu 和 HappyHorse 即使共享同一聚合平台 Key，也不是同一个模型协议。核对以下参数：首帧/尾帧/多参考图数量、图像顺序、提示词字段、比例、分辨率、时长、音频、异步任务查询地址和结果下载地址。模型下拉菜单的标签必须来自实际绑定，不能用一个历史默认值覆盖不同供应商结果。

阿里云官方文档说明 Key 与服务 Endpoint 的地域/协议需要对应。创建 Key 后记录 Workspace 和地域，但不要记录明文 Key；控制台只显示一次明文时，应立即写入秘密管理器并关闭页面，不能截屏留档。

## 9. LaoZhang 兼容网关

- 网关文档：<https://docs.laozhang.ai/en/getting-started>
- 网关控制台：<https://api.laozhang.ai/>

这是第三方兼容网关，不是所有上游模型厂商的官方网站。部署者必须自行评估服务条款、数据保留、日志、地区、内容审核、计费、模型真实性和可用性。

当前标识：

- `sora2`：视频，Key `SORA2_API_KEY`；
- `veo`：视频，Key `VEO_API_KEY`，当前代码可能回退 `SORA2_API_KEY`；
- `laozhang-gpt-image`：图片 VIP Key，`GPT_IMAGE_API_KEY`；
- `laozhang-sora2`：另一图片 Key 组，`SORA2_GPT_IMAGE_API_KEY`；
- LaoZhang 当前接入文档将默认基址写为 `https://api2.laozhang.ai/v1`，并另外列出海外直连和 Cloudflare 备用域名；域名、用途和限制必须以部署当天的网关公告为准。

当前开发树中仍存在 `https://api.laozhang.ai/v1` 这一历史默认值。公开部署不得因为它出现在注册表就直接采用：管理员必须从网关当日文档确认迁移状态，在后台显式填写最终 Endpoint，并完成健康检查与最小真实生成。发行前也必须决定是否迁移代码默认值并跑完所有网关协议测试；仅把文档链接改新不能证明视频、图片和模型列表端点都兼容。

不要把网关 Key 填到官方平台 Endpoint，也不要把官方平台 Key 交给网关，除非网关官方文档明确要求且完成风险评估。不同 Key 组应建独立卡，名称写清“网关”和用途。

## 10. 代理模式

默认使用 `direct`。只有服务器确实无法直连且代理由部署者控制时才使用 `custom`。

代理安全清单：

- 代理必须使用受信任证书；
- 不得关闭 TLS 证书验证；
- 代理日志不得保存 Authorization 和请求正文；
- 只有管理员能修改代理地址；
- 禁止普通用户通过参数控制目标主机，防止 SSRF；
- 对代理故障设置明确超时，不无限重试；
- 明确代理是否跨境、是否保留素材和提示词。

生产还应验证代理无法访问云元数据、数据库、Redis、内部管理接口和本机文件服务。应用层 URL 校验不能完全阻止 DNS rebinding，出口防火墙/代理允许列表是必要的第二层。代理返回 30x 时 Ovideo 不应自动跟随；部署者应核对最终地址并显式更新配置。

## 11. 健康检查与真实测试的区别

健康检查通常只能证明 Endpoint 可达、Key 可能有效或模型列表可读；它不能证明生成成功、参数兼容、额度充足、内容审核通过或实际模型正确。

每张卡的上线验收应分别记录：

- 非计费健康结果；
- 最小真实生成结果；
- 实际供应商请求 ID；
- 实际模型 ID；
- 费用/点数变化；
- 失败分类和用户提示；
- 重试是否幂等；
- Key 是否只在服务端出现。

## 12. Key 轮换

1. 在平台创建新 Key；
2. 保持旧 Key 暂时有效；
3. 在 Ovideo 新建或更新一张禁用卡；
4. 做健康检查和最小真实生成；
5. 启用新卡并观察错误率/费用；
6. 禁用旧卡；
7. 撤销平台旧 Key；
8. 检查日志、备份、导出和历史中没有明文；
9. 更新轮换记录。

若怀疑泄露，优先撤销/限制凭据，并检查供应商用量。仅从最新代码删除 Key 不能消除 Git 历史、缓存和日志中的泄露。

## 13. 每个平台都要保存的验收记录模板

验收记录不得保存完整 Key 或用户私密素材，至少包含：

| 项目 | 要记录的内容 |
| --- | --- |
| 卡片标识 | Ovideo 配置 ID、名称、provider、category、scope、operation |
| 凭据来源 | 平台/网关名称、组织或项目的非秘密标识、创建日期、责任人、轮换日期 |
| 连接 | Endpoint 主机、地域、协议版本、直连/代理、TLS 验证结果 |
| 模型 | 请求模型 ID、供应商响应/任务记录的实际模型 ID、账户权限 |
| 输入 | 文本、图片、视频、音频各自数量/字节/MIME/像素/时长边界，不能保存敏感原文 |
| 输出 | 状态码、任务 ID 的脱敏尾段、MIME、尺寸、时长、音轨、文件哈希 |
| 费用 | 测试前后额度变化、单次费用、预算和告警阈值 |
| 失败 | 400/401/403/404/408/429/5xx、超时、取消、内容安全和余额不足的用户提示 |
| 安全 | 浏览器无 Key、日志无 Key/提示词、错误脱敏、SSRF/重定向/危险 Header 被拒绝 |
| 恢复 | 禁用卡片、回切旧卡、撤销 Key、恢复异步查询和处理重复请求的步骤 |

同一平台新增模型、切换地域、改变计费通道或更新 Endpoint，都要重新填写这份记录。旧模型仍能调用不代表新模型参数兼容；新模型健康检查成功也不代表历史任务展示和费用统计正确。
