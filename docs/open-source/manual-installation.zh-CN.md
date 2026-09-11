# SceneGo 开源版部署教程

本文从一台空服务器开始说明部署过程。它不是安装脚本，也不会替使用者判断系统兼容性。请先在隔离测试环境完整走通，再决定是否对外提供服务。

## 1. 推荐拓扑

最小生产拓扑包含五个独立责任：

1. 反向代理：终止 HTTPS、限制请求大小、设置安全响应头、实施基础速率限制；
2. Ovideo 后端：运行 FastAPI，并托管使用者自行编译的两个前端；
3. PostgreSQL：保存用户、项目、任务、素材索引、计费和配置元数据；
4. Redis：保存任务队列、进行中状态、事件和短期验证码状态；
5. 媒体存储：由使用者选择本机磁盘或自行配置的对象存储。

在线模型 API 是外部依赖。ComfyUI 是可选、自行安装、自行实现连接器的独立依赖，不属于公开版自带组件。

即使把组件装在同一台机器，也要把它们视为不同安全边界。数据库和 Redis 不应直接暴露到公网；Ovideo 应通过专用系统账号运行；反向代理是唯一公网入口。

## 2. 发布前提

不要从普通开发分支直接部署公开版。取得源码后先确认：

```bash
git status --short
git rev-parse HEAD
git tag --points-at HEAD
```

预期结果：工作树为空；提交号与发行说明一致；如使用发行标签，标签必须指向该提交。

再运行公开边界检查：

```bash
python deploy/scripts/check_public_release_boundary.py --candidate-root .
```

如果检查提示 Docker、部署制品、Ovideo ComfyUI 实现、真实配置或缺少文档，必须停止。不要为了让检查变绿而删除规则。

## 3. 系统要求与版本记录

在开始前建立自己的部署记录，至少记录：

- Linux 发行版和内核，或 Windows 版本与补丁级别；
- CPU 架构和内存；
- Python、pip、Node.js、npm、PostgreSQL、Redis、FFmpeg、Git 的版本；
- Ovideo 提交号；
- 域名、反向代理类型、证书签发方式；
- 数据库/Redis/媒体目录的备份位置和恢复责任人。

建议使用仍在上游安全维护期内的稳定版本。发布标签中的锁定文件和安全公告优先于本文示例。当前开发树存在尚未解除的依赖安全阻断，不能把本文理解为“当前任意提交均可安全上线”。

Linux 检查示例：

```bash
uname -a
python3 --version
node --version
npm --version
psql --version
redis-server --version
ffmpeg -version
git --version
```

Windows PowerShell 检查示例：

```powershell
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsArchitecture
python --version
node --version
npm --version
psql --version
redis-server --version
ffmpeg -version
git --version
```

## 4. 创建最小权限运行账号和目录

生产环境不要用 `root` 或个人登录账号长期运行应用。Linux 可由管理员创建不可登录的服务账号，并为源码、配置、媒体和日志分别规划目录。下面只是命名示例：

```text
/srv/ovideo/source       只读源码与构建输入
/srv/ovideo/runtime      Python 虚拟环境和运行目录
/srv/ovideo/media        用户上传与生成媒体
/etc/ovideo              仅服务账号可读的环境配置
/var/log/ovideo          应用日志
/var/backups/ovideo      加密备份或备份挂载点
```

权限原则：

- 源码拥有者和运行账号可以不同；
- 环境配置必须是最小可读权限，不能由 Web 服务写入；
- 媒体目录只允许运行账号读写，不能允许任意系统用户写入；
- 日志不得记录 Authorization、Cookie、API Key、验证码、完整手机号和带 token 的 URL；
- 备份目录不能放在 Web 根目录下。

Windows 应创建专用低权限服务账号，拒绝交互式登录，不加入 Administrators；应用、配置、媒体和日志分别设置 NTFS ACL。不要把服务密码、API Key 或数据库密码保存在批处理文件中。

## 5. PostgreSQL 安装与初始化

### 5.1 安装

从 PostgreSQL 官方仓库或操作系统受信任仓库安装仍受支持的版本。不要使用来源不明的二进制包。官方文档：<https://www.postgresql.org/docs/current/installation.html>。

### 5.2 网络边界

如果数据库与应用同机，优先只监听 loopback。分机部署时，只允许应用服务器私网地址访问 5432，并在 `pg_hba.conf` 中使用加密口令认证。绝对不要把 5432 对全网开放。

### 5.3 创建数据库和用户

以 PostgreSQL 管理员进入 `psql`，执行以下命令并把占位符替换为随机强密码。不要把真实密码复制进 Git 或 shell 历史：

```sql
CREATE ROLE ovideo_app
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  PASSWORD '<FILL_ME_WITH_RANDOM_DATABASE_PASSWORD>';

CREATE DATABASE ovideo
  OWNER ovideo_app
  ENCODING 'UTF8'
  TEMPLATE template0;
```

核验：

```sql
\du ovideo_app
\l ovideo
```

应用运行账号不应拥有 `SUPERUSER`、`CREATEDB`、`CREATEROLE` 或复制权限。迁移需要的 DDL 权限应仅限 Ovideo 数据库。高安全环境可以把迁移账号与日常运行账号分离。

### 5.4 写入数据库配置

复制示例并编辑配置：

```bash
cp deploy/configs/database.env.example deploy/configs/database.env
```

必须修改：

```dotenv
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=ovideo
DB_USER=ovideo_app
DB_PASSWORD=<FILL_ME_WITH_RANDOM_DATABASE_PASSWORD>
DB_SSLMODE=disable
DB_POOL_MIN_SIZE=2
DB_POOL_MAX_SIZE=20
DB_MAX_QUERIES=50000
DB_MAX_IDLE_TIME=300
```

`database.env` 只能存在于部署机器的受限配置目录，不得提交。连接池上限必须结合 PostgreSQL `max_connections`、应用进程数和其他服务计算，不能照抄示例。

这里的 `DB_SSLMODE=disable` 只适用于同机回环示例。数据库在另一台主机时，应使用受信 CA 签发、主机名匹配的证书并配置 `DB_SSLMODE=verify-full`。`require` 虽然加密，但不验证目标身份；不能把它当作 `verify-full` 的同义词。公开版生产代码对远程数据库默认失败关闭，除非操作者显式启用高风险兼容开关并完成书面网络审查。

建库和迁移命令也遵守这套规则，并将 `DB_SSLMODE` 传给数据库驱动；省略时，同机回环默认 `disable`，远程默认 `verify-full`。建库命令按“进程环境 → `configs/database.env` → 默认值”读取连接配置；迁移命令只读取进程环境与显式 `--env` 文件，不自动切换到其他配置文件，进程环境优先，多份 `--env` 中先出现的值优先。生产安全规则由 `OSTORY_RUNTIME_ENV=production` 启用，应在运行命令前设置（或在迁移命令显式加载的环境文件中设置）。`--check` 仅检查建库清单文件，不连接数据库，也不能证明连接配置正确。

### 5.5 初始化空数据库

进入已安装应用依赖的 Python 虚拟环境后先只检查迁移清单：

```bash
cd deploy
python db_build/build_fresh_db.py --check
```

确认清单完整后，备份空库状态并执行：

```bash
python db_build/build_fresh_db.py
```

预期：每个迁移显示已应用或已采用，最后返回成功。失败时不要跳过单个迁移，也不要直接修改 `schema_migrations` 校验和。修复根因、恢复空库，再从头验证。

包含 `db_migration_session_version.sql` 的版本会启用可撤销会话。升级完成后，旧令牌因为没有会话版本声明而统一失效，所有用户需要重新登录一次。这是有意的安全边界，不应通过放宽令牌解析来规避。之后只要用户修改或找回密码、管理员禁用账号、调整角色或收回权限，数据库会原子递增该账号的 `session_version`，先前签发的所有浏览器 Cookie 和 Bearer 令牌会立即失效。若升级后所有新登录也立即失效，应先确认迁移已经成功，再核对应用连接的数据库是否与迁移目标一致；不要把会话版本校验关闭。

查看迁移账本：

```bash
python scripts/apply_migrations.py --env configs/database.env --status
```

## 6. Redis 安装与加固

官方安装文档：<https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/>。Redis 会调整文档路径；若该深层链接迁移，应从 <https://redis.io/docs/latest/operate/oss_and_stack/install/> 重新选择当前操作系统，而不是使用搜索结果中的第三方安装脚本。公开版不提供 Docker 方式；即使 Redis 官方页面同时展示 Docker，本文也只允许使用者自行完成宿主机或受信托管服务安装。

Redis 保存队列和短期认证状态，不能当作“无所谓的缓存”处理。

最低要求：

- 只监听 loopback 或受防火墙保护的私网地址；
- 保持 protected mode；
- 配置随机强密码或 Redis ACL 用户；
- 禁止公网访问 6379；
- 根据恢复目标选择 AOF/RDB；
- 为队列预留内存，避免随意使用会淘汰任务键的策略；
- 限制配置文件权限；
- 备份和恢复演练与 PostgreSQL 一起执行。

环境参数示例：

```dotenv
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
REDIS_USERNAME=ovideo_app
REDIS_PASSWORD=<FILL_ME_WITH_RANDOM_REDIS_PASSWORD>
REDIS_SSL=false
REDIS_SSL_CA_CERTS=
PUBLIC_BIND_HOST=127.0.0.1
PUBLIC_BIND_PORT=6006
ONLINE_PROVIDER_WORKERS_COUNT=4
ONLINE_PROVIDER_TASK_MAX_RETRIES=3
ONLINE_PROVIDER_TASK_RETRY_DELAY_SECONDS=10
```

验证连通性时使用 Redis 的安全密码输入方式，不要把密码直接写在命令行。期望结果是 `PONG`。然后检查仅绑定到预期地址，防火墙没有公网入站规则。

同机回环示例可以使用 `REDIS_SSL=false`。Redis 在另一台主机时，必须启用 TLS、配置受信 CA，并为 `REDIS_USERNAME` 创建最小权限 ACL 用户。生产代码默认拒绝“远程 + 无认证”以及“远程 + 明文”组合；`ALLOW_UNAUTHENTICATED_REMOTE_REDIS` 和 `ALLOW_INSECURE_REDIS_TRANSPORT` 只是有期限的审计例外，不是正常安装步骤。

Redis ACL 至少要根据当前发行版实际执行的命令做集成测试。不要盲目授予 `+@all` 或 `~*`；也不要仅凭一次 `PING` 判断队列可用。应测试任务入队、领取、状态更新、事件发布、限速 Lua 脚本和过期键，并确认应用账号无法执行 `CONFIG`、`FLUSHALL`、`FLUSHDB` 等管理操作。

## 7. Python 后端环境配置

从空虚拟环境开始，避免继承系统级包。以下锁文件面向 CPython 3.12、x64；Linux 使用 glibc 2.34 或更新版本（验证环境为 Ubuntu 24.04），Windows 使用原生 64 位解释器。其他 Python、CPU 或 musl 环境需要独立解析和验收，不要跳过检查强装不匹配的锁文件：

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python deploy/scripts/check_python_dependency_locks.py --profile linux-cpython312 --check-environment
python -m pip --isolated install --require-hashes -r deploy/dependency-locks/bootstrap.txt
python -m pip --isolated install --require-hashes -r deploy/dependency-locks/build.txt
python -m pip --isolated install --require-hashes --no-build-isolation -r deploy/dependency-locks/linux-cpython312-runtime.txt
python -m pip check
```

Windows PowerShell：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python deploy/scripts/check_python_dependency_locks.py --profile windows-cpython312 --check-environment
python -m pip --isolated install --require-hashes -r deploy/dependency-locks/bootstrap.txt
python -m pip --isolated install --require-hashes -r deploy/dependency-locks/build.txt
python -m pip --isolated install --require-hashes --no-build-isolation -r deploy/dependency-locks/windows-cpython312-runtime.txt
python -m pip check
```

安装后必须执行依赖漏洞扫描。公开发行方不提供已经装好的虚拟环境，也不允许把 `.venv` 提交或复制到其他机器。

`requirements.txt`、`requirements-test.txt` 是维护用的直接依赖输入；上述安装使用含全部传递版本和 SHA-256 的平台锁文件。运行、测试、安装器和构建工具分开记录，测试工具不装入普通运行环境。修改直接依赖后，检查器会拒绝旧锁文件。

短信 SDK 的 `alibabacloud-tea==0.4.3` 只提供源码包，因此仅对这一包允许源码构建，并固定其原始归档哈希。先按 `build.txt` 安装锁定的构建工具，再用 `--no-build-isolation` 禁止 pip 另行下载未锁定的构建依赖；其他依赖只允许 wheel。不要删除哈希、扩大源码例外、使用 `--no-require-hashes`，也不要用 `--no-deps` 隐藏遗漏的依赖。

这是指定环境的依赖输入与发行物锁定，不是编译产物逐字节可复现或完整供应链验收。安装器、构建工具、系统组件也需要审计；版本更新必须重新核对官方公告、实际解析结果和完整回归，不得为了消除告警自动执行 `--fix`。

具体审计范围、许可证证据和待补充项见 [依赖与第三方许可复核](dependency-review.zh-CN.md)。

重要：依赖文件必须来自已通过安全门禁的正式公开标签。若扫描存在未处理的高危或严重漏洞，停止上线；不要以“代码能启动”为通过标准。

## 8. 主前端编译

主前端位于 `deploy/new_html`。Vite 会把结果写到 `deploy/dist`，该目录是使用者自己的构建产物，不属于公开源码。

以下命令从源码仓库根目录开始，逐条执行并检查退出状态；任一步失败都先排查，不要继续下一步。`npx --no-install` 只调用使用者刚刚通过锁文件安装的本地编译器，不从网络临时下载其他版本。

```bash
cd deploy/new_html
npm ci
npm run typecheck:public
npm run test:public
npx --no-install vite build --config vite.public.config.ts
cd ../..
```

必须显式选择 `vite.public.config.ts`（与标准 `build:public` 编译命令使用同一配置）。这个构建配置会把开发仓库中的本地节点选择、节点任务提交、本地视频处理和 ComfyUI 文件中继替换为公开版的明确禁用实现，同时保留在线 API、项目、素材和音视频业务能力。不要省略 `--config` 或用普通的 `npm run build` 代替：普通构建是私有开发版入口，不属于公开发行契约；在经过裁剪的公开候选仓库中，它也不应作为安装命令使用。

公开构建以 `deploy/new_html/public-entry/index.html` 作为独立根入口，其中站点 URL 是不可用占位域名。使用者应在自己的私有部署配置/构建步骤中替换为自有域名，但不得把发行方生产域名复制到公开候选。开发仓库的 `deploy/new_html/index.html` 属于私有站点入口，组装公开候选时必须排除；不能为了通过测试而把私有入口永久改成公开占位值。

类型检查、测试、构建必须使用同一公开版配置。`@runtime/` 导入由 `tsconfig.public.json` 指向公开实现，Vite 与 Vitest 复用同一映射。不能只验证 Vite 能打包就宣称源码可独立使用。`__tests__/private-runtime/` 仅存放私有节点/旧界面实现的测试，公开候选不包含它们；共有业务测试继续在公开版运行。完整平台的默认检查仍运行全部测试并加载原实现，不可用公开版测试代替完整平台回归。

核验：

- `npm ci` 使用锁文件且没有修改锁文件；
- 测试通过；
- `deploy/dist/index.html` 存在；
- `deploy/dist/.vite/manifest.json` 存在；
- 构建日志没有真实 API Key；
- `npm audit --omit=dev` 没有未接受的高危/严重漏洞；
- `dist` 不提交到 Git。

随后从仓库根目录执行：

```bash
python deploy/scripts/check_public_frontend_boundary.py --dist-root deploy/dist
```

检查失败时停止安装。不能通过删除检查器、改名私有模块或注释报错继续发布。

不要在任何 `VITE_*` 变量中放第三方模型密钥。Vite 环境变量会进入浏览器可下载的 JavaScript。模型密钥只能保存在后端环境或后端加密配置中。

## 9. 自由创作前端编译

自由创作前端位于 `studio`，会输出到 `studio/dist`。再次确认终端位于源码仓库根目录，再逐条执行：

```bash
cd studio
npm ci
npm run typecheck:public
npm run test:public
npx --no-install vite build --config vite.public.config.ts
cd ..
```

Studio 会跨目录复用主前端服务，因此这里同样必须显式选择 `vite.public.config.ts`，不能只对主前端做隔离。核验 `studio/dist/index.html`、`studio/dist/.vite/manifest.json` 和 `studio/dist/assets/` 存在。该目录同样是使用者自己的构建产物，不得提交到公开源码仓库。

页面入口固定读取源码树内的 `deploy/dist/index.html`、`studio/dist/index.html` 和 `deploy/login.html`，不会从终端当前目录或旧的 `deploy/new_html/dist` 寻找替代文件。入口缺失时返回 HTTP 503，并禁止缓存错误页面；不能只检查后端健康接口就判定前端已经安装完成。页面入口的路径独立不代表其他运行配置可忽略工作目录，后端仍按下文指定目录启动。

登录页的 `deploy/static/js/slider-captcha.js` 和 `deploy/static/css/slider-captcha.css` 是必需的同源安全验证源码，不是旧工作台脚本或打包产物。公开候选必须保留它们，运行时确认对应 `/static/` 请求返回实际 JS/CSS 而不是 404 或 HTML；同目录其他旧令牌脚本仍应排除。不可通过关闭验证码校验来掩盖资源缺失。

上述步骤只编译源码，不会上传静态文件、安装反向代理、签发证书或注册后台服务。使用者必须继续按后面的章节自行完成这些配置与运行验证；公开版不提供能够串联这些操作的部署工具。

从仓库根目录同时检查两个前端成品：

```bash
python deploy/scripts/check_public_frontend_boundary.py \
  --dist-root deploy/dist \
  --studio-dist-root studio/dist
```

## 10. 必需密钥

上线前至少生成四个互不相同的服务端随机秘密；公开反馈建议再使用第五个专用秘密：

- `JWT_SECRET_KEY`：会话令牌签名；
- `OSTORY_VERIFICATION_CODE_SECRET`：验证码/绑定令牌安全；
- `OSTORY_AUTH_RATE_LIMIT_SECRET`：登录限速键的隐私摘要；
- `OSTORY_PUBLIC_RATE_LIMIT_SECRET`：公开意见限速摘要；可复用上一项，但生产推荐隔离；
- `API_CONFIG_ENC_KEY`：数据库中第三方 API Key 的 Fernet 加密；
- `OSTORY_CAPTCHA_SECRET`：自托管滑块验证的服务端秘密，建议独立配置。

示例生成方法会把结果打印到当前终端，请确保终端未录屏、未共享，生成后立即写入秘密存储并清屏：

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

除明确允许反馈限速复用登录限速摘要、滑块验证通过独立 HMAC 域隔离使用验证码秘密外，各秘密用途不得复用同一个值，生产均推荐隔离。不要把秘密写进仓库示例、进程参数、截图、Issue 或日志。轮换前先制定会话失效、限速窗口切换和 API Key 重加密方案。

## 11. 后端环境配置

根据 [配置参数总表](configuration-reference.zh-CN.md) 创建仅服务账号可读的环境文件或使用系统秘密管理器。至少设置：

```dotenv
OSTORY_RUNTIME_ENV=production
JWT_SECRET_KEY=<FILL_ME_WITH_RANDOM_SECRET>
OSTORY_VERIFICATION_CODE_SECRET=<FILL_ME_WITH_DIFFERENT_RANDOM_SECRET>
OSTORY_AUTH_RATE_LIMIT_SECRET=<FILL_ME_WITH_THIRD_RANDOM_SECRET>
OSTORY_PUBLIC_RATE_LIMIT_SECRET=<FILL_ME_WITH_FOURTH_RANDOM_SECRET>
API_CONFIG_ENC_KEY=<FILL_ME_WITH_FERNET_KEY>

AUTH_CAPTCHA_REQUIRED=true
AUTH_CAPTCHA_PROVIDER=slider
OSTORY_CAPTCHA_SECRET=<FILL_ME_WITH_DISTINCT_RANDOM_SECRET>

AUTH_LOGIN_RATE_LIMIT_ENABLED=true
AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS=900
AUTH_LOGIN_RATE_LIMIT_IDENTITY_ATTEMPTS=10
AUTH_LOGIN_RATE_LIMIT_IP_ATTEMPTS=100
PUBLIC_FEEDBACK_RATE_LIMIT_ENABLED=true
PUBLIC_FEEDBACK_VISITOR_WINDOW_SECONDS=600
PUBLIC_FEEDBACK_VISITOR_ATTEMPTS=10
PUBLIC_FEEDBACK_SHARE_WINDOW_SECONDS=3600
PUBLIC_FEEDBACK_SHARE_ATTEMPTS=100
OSTORY_BUILTIN_ADMIN_USERNAME=<FILL_ME_WITH_NON_DEFAULT_OWNER_NAME>
ADMIN_PASSWORD=<FILL_ME_WITH_ONE_TIME_RANDOM_PASSWORD>
OSTORY_SUPER_ADMIN_USERNAMES=<SAME_USERNAME_AS_ABOVE>
CORS_ALLOW_ORIGINS=https://app.example.invalid
TRUSTED_HOSTS=app.example.invalid
MAX_REQUEST_BODY_BYTES=104857600
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=ovideo
DB_USER=ovideo_app
DB_PASSWORD=<FILL_ME>
DB_SSLMODE=disable
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
REDIS_USERNAME=ovideo_app
REDIS_PASSWORD=<FILL_ME>
REDIS_SSL=false
REDIS_SSL_CA_CERTS=
```

生产环境不得启用开发管理员密码、开发验证码或公开注册兼容开关。上面的内置账号和密码只用于首次引导：账号成功登录后，服务把显式配置的用户名写成数据库 `super_admin` 角色，并记录不可重复应用的配置摘要。确认后台权限和 `users.role` 正确后，立即删除 `ADMIN_PASSWORD`、`OSTORY_BUILTIN_ADMIN_USERNAME`、`OSTORY_ADMIN_USERNAMES` 和 `OSTORY_SUPER_ADMIN_USERNAMES`，重启并再次登录验证。用户名本身永远不授予管理员权限。

## 12. 媒体目录

创建上传、临时和持久化目录，设置最小 ACL，并确保路径不通过反向代理直接暴露为目录列表。

必须规划：

- 单文件上限和总容量；
- 允许 MIME 类型和实际文件签名校验；
- 临时文件清理周期；
- 软删除保留期与彻底删除审批；
- 数据库记录与磁盘对象的一致性检查；
- 备份范围、加密、异地保存和恢复演练；
- 用户删除请求及审计日志。

严禁将媒体目录设置成仓库子目录后提交。严禁让 Web 用户控制最终磁盘绝对路径。

后端只允许从 STORAGE_BASE_PATH、LOCAL_STORAGE_PATH、默认 persistent_storage 和兼容上传目录读取数据库所指向的本地媒体。权限校验通过并不代表磁盘路径可信；数据库中的绝对路径、父目录跳转路径和符号链接越界仍必须被拒绝。若把存储放在仓库外，应显式填写上述路径并用服务账号验证读取权限，不能通过放宽路径根目录来“修复”404。

还应按业务文件长度设置 `MAX_REQUEST_BODY_BYTES`、`MAX_UPLOAD_SIZE`、`MAX_IMAGE_SOURCE_PIXELS`、`MAX_PROVIDER_IMAGE_INPUT_BYTES`、`MAX_PROVIDER_AUDIO_INPUT_BYTES`、`MAX_PROVIDER_VIDEO_INPUT_BYTES`、`MAX_REMOTE_IMAGE_DOWNLOAD_BYTES`、`MAX_REMOTE_AUDIO_DOWNLOAD_BYTES` 和 `MAX_REMOTE_VIDEO_DOWNLOAD_BYTES`。它们分别控制整次请求、单文件上传、图片解码像素、发送给在线供应商的图片/音频/视频输入，以及三类远程结果下载，不得混为一个总配额。生产反向代理的请求体上限应小于或等于应用上限，任务并发乘以单文件上限后必须仍在内存、临时盘和出口带宽预算内；内联音视频还要额外预留 Base64 膨胀空间。

## 13. 首次本地启动

先只监听回环地址，在反向代理之前验证：

```bash
cd deploy
python public_main.py
```

公开源码版必须使用 `public_main.py`，不能改用开发仓库的 `cluster_main.py`。后者属于同时装配私有本地执行与集群功能的开发/私有入口，不在公开发行边界内。公开入口默认监听 `127.0.0.1:6006`；通过 `PUBLIC_BIND_HOST` 和 `PUBLIC_BIND_PORT` 调整。只有在已经建立防火墙、TLS 反向代理和访问控制后，才可按自己的网络拓扑修改监听地址。使用者必须通过本机端口检查确认实际监听地址，不应只根据日志推断。

`public_main.py` 只启动在线 API 任务队列和在线供应商 Worker。公开版若需要本地 ComfyUI，必须由使用者依据官方协议自行实现、审计并维护连接器；公开发布方不会提供 Ovideo 已开发的 Agent、工作流、节点、GPU 调度或部署代码，也不能把私有入口复制进公开版来绕过这一边界。

最小验证：

- 进程成功连接 PostgreSQL 和 Redis；
- 迁移账本无校验和错误；
- 主前端和 `/studio/` 页面能加载；
- 未登录用户不能读取他人项目、任务、素材和管理接口；
- `/storage`、`/uploads` 不得绕过授权读取私有媒体；
- 详细健康、队列、节点和供应商状态不对匿名用户开放；
- API 文档在生产中关闭或仅管理员可访问。

当前源码已加入对象级媒体授权、受控本地路径和粗粒度匿名健康响应；正式公开标签仍必须在全新候选历史中完成双账号越权、路径穿越、符号链接逃逸、匿名健康与生产配置回归，不能仅凭单元测试宣布安全。

## 14. 反向代理和 TLS

使用者自行选择 Nginx、Caddy、Apache、HAProxy 或云负载均衡器，并依据其官方文档完成配置。公开版不交付现成生产配置。

必须实现：

- HTTP 自动跳转 HTTPS；
- 只允许现代 TLS；
- 上传路径单独设置合理请求体上限和超时；
- WebSocket/SSE 路径正确透传；
- 登录、验证码、密码重置、公开反馈等敏感流程按 IP 和账号限速；
- 添加 HSTS、`X-Content-Type-Options`、合适的 `Content-Security-Policy`、`Referrer-Policy` 和 `Permissions-Policy`；
- 不记录 Authorization、Cookie、验证码、API Key 或完整查询 token；
- 拒绝点文件、备份、环境文件和数据库文件；
- 只代理到回环或私网后端，不直接暴露 PostgreSQL、Redis 和 ComfyUI。

配置完成后，用浏览器开发者工具和命令行分别核对响应头、重定向、上传、SSE/WebSocket 和大文件超时。

## 15. 建立系统服务

使用者必须自己编写 systemd、Windows Service 或其他进程管理配置。配置至少包含：

- 专用低权限用户；
- 明确工作目录；
- 指向虚拟环境 Python 的绝对路径；
- 从权限受限位置加载环境变量；
- 合理重启策略和启动频率限制；
- 文件句柄、进程和内存限制；
- 只读系统目录、私有临时目录等沙箱选项；
- 标准输出/错误输出的安全日志策略；
- 停止超时和优雅退出。

不要复制发行方生产服务文件。每台机器的路径、用户、限制和依赖顺序都必须由部署者核验。

## 16. 上线前验收

后端回归必须使用单独的临时 PostgreSQL 测试库，不能使用上文安装的业务库或其备份。`test_db` 测试夹具只读取 `OSTORY_TEST_DATABASE_URL`，不会回退到应用的 `DB_*`、`DATABASE_URL`、`PG*` 或 `configs/database.env`。连接必须是回环地址，库名包含独立的 `test` 段（如 `ostory_test` 或 `test_ci`）；CI 也应将专用数据库端口映射到回环地址。

由测试负责人先创建仅用于测试的数据库和低权限账号，在隔离环境中使用该账号手动执行候选版的数据库初始化步骤。将临时密码注入环境，不要提交到仓库或复制业务凭据。示例连接格式为 `postgresql://test_user:REPLACE_TEST_ONLY_PASSWORD@127.0.0.1:25432/ostory_test`，可用 `?sslmode=require` 等参数显式选择 TLS；不允许通过查询参数覆盖主机或库名。

完整验收时同时设置 `OSTORY_REQUIRE_TEST_DB=true` 和 `OSTORY_TEST_DATABASE_URL`。前者让缺失配置或连接失败明确报错，不能静默跳过。未配置连接时的日常单元测试会明确跳过数据库集成项；这种结果不代表完整后端验收通过。每个数据库测试在独立事务中运行并回滚，但仍不得指向业务数据。测试环境不应有生产供应商密钥，也不应能访问生产网络或生成节点。

全量后端测试还会检查 JavaScript/TypeScript 注释与 Git 文件清单。因此，同一个测试环境中必须能运行 Node.js 和 Git，并已按前端编译章节执行 `npm ci` 安装解析器。Windows 与 WSL/Linux 应各自安装依赖并使用本系统可解析的 Git 工作树，不要跨系统复用虚拟环境、`node_modules` 或含另一系统绝对路径的工作树元数据。

在专用测试虚拟环境中安装测试依赖并检查兼容性；不要把测试依赖额外安装到生产服务环境。以下命令从仓库根目录开始：

```bash
python deploy/scripts/check_python_dependency_locks.py --profile linux-cpython312 --check-environment
python -m pip --isolated install --require-hashes --no-build-isolation -r deploy/dependency-locks/linux-cpython312-test.txt
python -m pip check
```

Windows 使用 `windows-cpython312` 检查参数和 `windows-cpython312-test.txt`。测试虚拟环境也必须先按第 7 节完成同平台的安装器、构建工具和运行依赖安装；不要跨系统复制虚拟环境。

还须单独验证公开测试是否依赖开发目录。保持上述专用测试库设置，从仓库根目录执行：

```bash
python -m pytest -q deploy/tests/test_public_runtime_source_isolation.py
```

该测试把公开入口依赖、必要检查器及人工列出的最低回归文件复制到临时测试目录，用隔离 Python 进程运行；不继承应用数据库、Redis、供应商或代理配置，不允许内部子测试失败或跳过。测试沿用已安装的第三方依赖和专用 PostgreSQL；Redis 与供应商使用各测试明确声明的替代实现，不产生真实生成费用。这个临时目录不是公开发行包，不会安装中间件或部署服务，不能替代从真实候选完整安装、真实 Redis/HTTP、浏览器与供应商生成验收。

至少完成以下测试：

```bash
cd deploy/new_html
npm run typecheck:public
cd ../../studio
npm run typecheck:public
cd ..

python -m pytest -q deploy/tests
python deploy/scripts/check_python_dependency_locks.py
python deploy/scripts/check_code_comment_language.py
python deploy/scripts/check_open_source_hygiene.py
python deploy/scripts/check_public_import_boundary.py
python deploy/scripts/check_public_route_authorization.py
python deploy/scripts/check_public_release_boundary.py --candidate-root .
```

分别在两个前端运行类型检查、测试和生产构建；再运行 Python、npm 和 Git 历史密钥扫描。注释门禁要求源码注释和 Python 文档字符串使用英文，并拒绝纯分隔符、重复文件路径等无信息量注释；产品文案、提示词和中文部署文档不受影响。任何未解释失败都不是通过。

安全验收还应覆盖：

- 两个普通用户之间的项目、文件、任务、积分和分享越权；
- 普通用户访问管理员接口；
- 已删除/禁用用户的旧 token；
- 密码重置后旧会话失效；
- 默认网页登录响应不含 JWT；只有显式 `X-Ostory-Session-Mode: bearer` 的非浏览器客户端才收到 Bearer 兼容字段；
- 上传伪造 MIME、路径穿越、超大文件和压缩炸弹；
- SSRF、任意 URL 下载、Webhook 签名和重放；
- 供应商 Endpoint/代理的 HTTP、私网、重定向、DNS 变化和危险额外请求头；
- 登录/验证码/重置的速率限制；
- 匿名公开意见的访客桶、分享总桶以及 Redis 故障时的生产失败关闭；
- API Key 加密、日志脱敏和备份泄露；
- CORS、CSRF、XSS、CSP 和点击劫持；
- Redis/数据库中断后的任务一致性；
- 依赖漏洞和第三方许可证。

## 17. 备份、升级与回滚

备份至少包含 PostgreSQL 和媒体对象；Redis 是否纳入取决于任务恢复目标。备份必须加密、校验、异地保存并定期恢复演练。

升级顺序：

1. 阅读发行说明和迁移说明；
2. 在测试环境从真实数据的脱敏副本演练；
3. 记录当前提交、依赖和配置摘要；
4. 完成数据库和媒体一致性备份；
5. 构建新前端和新虚拟环境；
6. 运行迁移；
7. 切换服务并执行功能/安全冒烟；
8. 保留明确回滚窗口。

数据库迁移可能不可逆，不能假设回滚代码就等于回滚数据库。任何删除数据、清空队列或删除媒体的动作都必须单独确认并先做可恢复备份。

## 18. 常见失败顺序

遇到启动失败时按层排查：

1. 提交号和工作树是否正确；
2. Python/Node 版本是否与公开标签兼容；
3. 依赖是否从锁文件完整安装；
4. 环境文件是否被服务账号读取；
5. PostgreSQL 和 Redis 是否只在预期地址监听且凭据正确；
6. 迁移账本是否完整；
7. 两个前端是否真的完成生产构建；
8. 后端是否只在本机/私网监听；
9. 反向代理路径、SSE/WebSocket、超时和上传上限是否正确；
10. 第三方 API 的地域、Endpoint、Key、模型 ID 和计费模式是否对应。

排查输出必须脱敏。不要为了“先跑起来”关闭 TLS 校验、开放数据库/Redis 公网端口、使用默认密码、允许任意 CORS，或把密钥放进前端。
