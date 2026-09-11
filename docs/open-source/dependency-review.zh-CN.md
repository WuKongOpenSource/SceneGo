# 依赖与第三方许可复核

依赖扫描通过只表示所选漏洞库在扫描时未发现对应版本的已知问题，不证明应用安全，也不能替代许可证审查。正式发布必须保存与候选源码一致的审计证据；不要把旧报告套到新解析的依赖上。

## 安装与扫描范围

- `deploy/requirements.txt` 固定应用直接依赖；`deploy/requirements-test.txt` 固定测试工具。它们是锁文件的维护输入，不是发行安装命令；普通运行环境不安装测试工具。
- `deploy/dependency-locks/` 提供 CPython 3.12 x64 的 Linux/glibc 和 Windows 原生解析锁：运行、测试、安装器、源码构建工具分别记录精确版本和 SHA-256。测试文件引用同平台运行文件，不能替换运行版本。按 [安装手册第 7 节](manual-installation.zh-CN.md#7-python-后端环境配置) 检查环境并安装。
- `check_python_dependency_locks.py` 检查直接输入、锁文件哈希、所选环境与必要 extras，不联网、不安装包。它不替代 pip 原生依赖解析：验收必须从空环境按锁文件安装，启用 `--require-hashes`，保留依赖检查，再执行 `pip check` 和回归；还应证明篡改哈希和漏列传递依赖确实被拒绝。
- `alibabacloud-tea==0.4.3` 没有上游 wheel，保留现有短信功能时不能一刀切禁止源码包。唯一源码例外固定原始归档哈希；构建前固定 setuptools、wheel、packaging，安装时禁用自动构建隔离依赖下载。新增源码例外必须另审构建入口和依赖，不能扩大为允许所有源码包。
- 这些锁不涵盖其他 Python 版本、ARM、musl、操作系统软件包、FFmpeg 及其动态库。归档输入锁定也不保证源码包生成的 wheel 字节完全一致；不得把一次安装成功或哈希匹配描述为完整供应链验收。
- 从实际安装环境提取所有包及精确版本，核对 `pip check`。扫描应用、测试和安装工具三类依赖，不得通过删掉告警包、隐藏退出码或自动 `--fix` 取得绿色报告。
- 审计工具使用独立环境，不要因安装扫描器而升级被检查环境。可对已完整解析的版本清单使用 `pip-audit --strict --no-deps --disable-pip -r <精确版本清单> --format json`；这里的 `--no-deps` 只避免重新解析，清单本身必须已包含全部传递依赖。
- pip、pytest、操作系统组件和 FFmpeg 不等同于网站运行时依赖。记录各自的受影响条件和修复范围，但不能因它们不在业务请求中执行就忽略安装、构建或测试风险。
- 对漏洞先查官方公告和修复版本，再做兼容性回归。pytest 的临时目录修正在 9.0.3，pytest-asyncio 从 1.3 支持 pytest 9；异步测试与 fixture 明确使用函数级事件循环，避免共享资源跨测试泄漏。

参考：[pip-audit 使用和安全模型](https://github.com/pypa/pip-audit)、[pytest 9.0.3 更新说明](https://docs.pytest.org/en/stable/changelog.html#pytest-9-0-3-2026-04-07)、[pytest-asyncio 更新说明](https://pytest-asyncio.readthedocs.io/en/stable/reference/changelog.html)、[pip 更新说明](https://pip.pypa.io/en/stable/news/)。

锁文件维护参考：[pip 哈希校验与安全安装](https://pip.pypa.io/en/stable/topics/secure-installs/)、[可重复安装的边界](https://pip.pypa.io/en/stable/topics/repeatable-installs/)、[短信 SDK 依赖的源码发行物](https://pypi.org/project/alibabacloud-tea/0.4.3/#files)。哈希必须来自已审查的源码版本；修改清单后重新计算哈希不等同于获得可信发布签名。

## SBOM 与许可证据

每份 SBOM 至少记录组件名称、版本、生态、直接/传递关系、运行/开发用途、下载来源和完整性；关联到实际候选文件哈希、Python/操作系统以及两个前端锁文件。只根据当前机器的 `node_modules` 生成清单会遗漏其他平台的可选包；只读取 Python 直接依赖也不完整。

### Node 清单生成与离线核对

分别在主前端和 Studio 的目录运行下面的单步命令。`<EVIDENCE_DIR>` 必须替换为源码树之外已创建的审计目录；保留原始报告，不能把两个项目写到同一个输出文件。记录实际 Node/npm 版本，清除审计进程继承的 `NODE_ENV`、`NPM_CONFIG_OMIT` 等筛选设置，并使用不含私有凭据的 npm 配置。

```bash
npm sbom --package-lock-only --sbom-format=cyclonedx --sbom-type=application --include=dev --include=optional --include=peer --offline --ignore-scripts > <EVIDENCE_DIR>/frontend.raw.cdx.json
```

在 `studio/` 中执行时把文件名换成 `studio.raw.cdx.json`。锁文件模式不安装包、不执行依赖脚本，也不根据当前操作系统删掉可选包；它缺少部分发行包内部的元数据，不能替代原始包的许可取证。[npm 官方说明](https://docs.npmjs.com/cli/v10/commands/npm-sbom/)

npm 10.9.8 的原生输出在不同嵌套路径存在同版本包时会重复使用 `bom-ref`。仅统计组件数无法发现这种关联歧义。仓库根目录下可用以下命令保留包的安装路径并生成唯一编号，再独立核对：

```bash
python deploy/scripts/check_npm_sbom.py --project-root deploy/new_html --sbom <EVIDENCE_DIR>/frontend.raw.cdx.json --normalize-native > <EVIDENCE_DIR>/frontend.cdx.json
python deploy/scripts/check_npm_sbom.py --project-root deploy/new_html --sbom <EVIDENCE_DIR>/frontend.cdx.json
python deploy/scripts/check_npm_sbom.py --project-root studio --sbom <EVIDENCE_DIR>/studio.raw.cdx.json --normalize-native > <EVIDENCE_DIR>/studio.cdx.json
python deploy/scripts/check_npm_sbom.py --project-root studio --sbom <EVIDENCE_DIR>/studio.cdx.json
```

逐步检查退出码，失败的空文件或部分输出不能作为报告。输出重定向不能指向任何输入文件；Windows PowerShell 5 的默认重定向编码并非 UTF-8，应使用支持 UTF-8 的终端或显式保存为 UTF-8。

检查器只支持已审查的 npm v3 注册表锁、单个 SHA-512 SRI 和 CycloneDX 1.5。它逐路径核对身份、版本、分发 URL、哈希、开发用途及完整依赖图（含存在的可选依赖和 peer），不靠组件数猜测完整性。普通检查拒绝重复编号；规范化只在原生输出的全部关系与锁文件一致、同编号确属同包且关系一致时进行，并保留原始报告 SHA-256。不同子依赖被压成同一编号等无法确认的情况必须重新导出，不能自动补猜。Workspace/link、别名或自定义来源需要单独审查，不能修改检查器来静默跳过它们。

这是锁文件一致性检查，不是 npm 的版本解析器、完整 JSON Schema 校验器、远端签名/归档校验器或发行许可审批。还须用独立工具按 [CycloneDX 官方 1.5 Schema](https://github.com/CycloneDX/specification/tree/1.5/schema) 验证，保留 Schema 文件哈希，在验证期间拒绝未登记的远端引用，并另外下载实际归档核对锁文件完整性。Schema 通过也不能单独证明依赖关系或许可完整。

### Python 配置与许可取证边界

Python 清单应分别基于 Linux 和 Windows 原生锁的实际安装元数据、安装报告和 `Requires-Dist`，按各自环境标记与 extras 计算闭包，核对每个下载归档的哈希。测试依赖可能同时也是运行或构建依赖，应保留多个用途，不能为了凑总数强制分成互斥类别。不要把 Linux 的 `uvloop` 套用到 Windows，或漏掉 Windows 的 `colorama`、`tzdata`。安装器/构建工具也纳入清单，但其内嵌的 vendored 库不一定出现在 `Requires-Dist`，仍须另查。

许可证字段只是包作者提供的元数据。还应逐项保留对应版本发行物内的 LICENSE、COPYING、NOTICE 和字体许可文本及哈希；如果发行物缺失这些文件，向对应上游版本核实，不要自行推断授权。完整审查必须包含字体、图标、示例图片、截图、文档素材、二进制附带库及其再分发要求。

文件名匹配只能筛选候选，不能直接累计为许可文本：例如 `icons/copyright.js` 和它的 source map 是图标代码，不是版权声明文件。字体包的 OFL 正文、图标包里的历史归属应保留；平台专用二进制包即使标为可选、元数据写了 MIT，也不能未经对应版本核对就用父包许可证代替。明确区分“归档哈希通过”“文本已收集”“上游缺件已核实”“发行已批准”四种状态。

第三方版权人姓名和上游许可要求的联系方式不属于应删除的产品私有标记。必须保留必要归属，不能为了源码清理或增加阅读难度删改许可文本。项目本身的许可证仍须由权利人明确选择；元数据收集和漏洞扫描不替代这一决定。

原始工具报告可能包含安装机器路径、索引凭据或其他环境信息，先审查再纳入公开资料。不得把虚拟环境、下载缓存、完整安装日志或未审查的报告直接加入公开源码。

当前 7 个 Python 发行物的许可缺件证据见 [局部补充清单](third-party/README.zh-CN.md)。该目录保存精确版本的声明、适用的上游许可正文及哈希，可运行 `python deploy/scripts/check_python_license_supplement.py` 检查它与当前原生锁是否一致。它不替代其余依赖的完整清单或最终发行审查；Tea 历史源码提交尚未定位的限制也明确保留。

当前 55 个 npm 缺件包见 [npm 局部证据与未完成项](third-party/npm-review.zh-CN.md)，运行 `python deploy/scripts/check_npm_license_supplement.py` 核对它与两个前端精确锁及对应安装路径是否一致。核心项目许可、父包完整归属、旧版本 README 声明与原生二进制附带库分别记录；不能把局部来源对应视为所有缺件已解决。

esbuild 的 26 个平台发行包另有原生/WASM 分类及 Go 归属证据，可运行 `python deploy/scripts/check_esbuild_distribution_evidence.py`。23 个原生包的内嵌构建元数据、3 个 WASM 包的加载脚本匹配、WASM 编译来源未确认三者分别记录。两份 Go 根许可/专利正文按 Go 和 `x/sys` 的固定提交保留，不据此宣称完整运行时/工具链许可已闭合。
