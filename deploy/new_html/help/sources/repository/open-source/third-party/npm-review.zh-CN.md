# npm 许可缺件补充证据（局部）

这份清单覆盖两个前端锁文件中 **55 个未附独立许可正文的发行包**。它记录来源和缺件，不是完整 SBOM，不代表许可问题全部解决，也不批准公开发行。没有安装或执行所下载的包，没有改动应用依赖、模型调用、任务持久化或计费。

`npm-license-supplement.json` 保留每个包的精确版本、下载 URL、SHA-512 SRI、归档 SHA-256、对应安装路径、注册表元数据来源及固定提交。四份上游许可/归属文件和一份版本内 README 许可段落单独保存，正文不删改。

| 范围 | 数量 | 已核实 | 仍需处理 |
| --- | ---: | --- | --- |
| `@esbuild/*` 0.25.12 | 26 | 23 个原生包取得内嵌构建元数据；3 个 JavaScript/WASM 包取得加载脚本源码匹配；核心 MIT 及固定 Go/`x/sys` 根许可已保留 | 内嵌元数据和脚本匹配不等于编译来源证明；运行时、vendored 库及传递归属仍未闭合 |
| `@rollup/rollup-*` 4.63.1 | 25 | 各平台发行元数据指向同一提交；核心 MIT 正文已保留；父包完整 LICENSE 与同提交文件一致 | 父包的 JavaScript 依赖归属不等于 native Rust 二进制及工具链许可齐全 |
| `@napi-rs/lzma-linux-x64-gnu` 1.5.1 | 1 | 精确归档和发布提交已对应 | 提交根目录没有 LICENSE/NOTICE，仅有 MIT 元数据；原生库和构建证据未闭合 |
| `dlv` 1.1.3 | 1 | `index.js` 和三个 source map 的内嵌源码都与固定提交相同；README 许可段落已保留 | 本版本没有独立许可正文；三个生成的 JavaScript 文件没有重建核对 |
| `saxes` 6.0.0 | 1 | 发布提交的完整 LICENSE 和 AUTHORS 已保留 | 编译后的 JavaScript 没有重建核对；source map 不含 `sourcesContent`，不能声称源码逐字节对应 |
| `stackback` 0.0.2 | 1 | 对应 tag 提交的 `index.js`、`formatstack.js`、`test.js` 与发行包逐字节一致 | 该提交没有独立许可正文，MIT 仅见包元数据；不能用其他版本的许可替代 |

## 证据边界

- 这 55 份归档均核对锁内 SHA-512 SRI；这里只保留哈希和观察结果，不把二进制、下载缓存、完整安装日志或机器环境加入源码。
- npm 的 `gitHead` 是发布者提供的元数据，不是二进制可重复构建证明。`stackback` 没有 `gitHead`，因此使用精确 `v0.0.2` tag 加逐文件比较；旧仓库地址重定向后的归属也显式记录。
- `dlv` 的 source map 内嵌内容匹配只证明这些内容相同，不能证明映射正确或产物无额外代码。`saxes` 的 source map 只有路径，不据此虚构源文件哈希对应。
- `saxes` 的许可证包含原 `sax` 的 ISC 归属及历史 MIT 段落，全部保留；AUTHORS 中的第三方姓名与联系方式不是应清理的产品私有数据。
- Rollup 父包完整 `LICENSE.md` 仍须随该包保留。本补充目录里的 `npm-rollup-4.63.1-core.txt` **只包含核心许可，不能替换完整 LICENSE**。清单保存完整文件的匹配哈希，不把核心许可说成二进制全部附带库的授权。
- 不依据当前外部网页自动生成版权年份或姓名；`dlv` 只保留这个版本原有的外部 MIT 链接。`stackback` 和 lzma 的正文缺失明确保留，不凭 MIT 字段编造文件。

固定来源：[esbuild](https://github.com/evanw/esbuild/tree/208f539945b145e7c9d6d844290f81c3fe5af320)、[Rollup](https://github.com/rollup/rollup/tree/78bfef0cb94479566f81012fafa372c84b90bd34)、[lzma](https://github.com/Brooooooklyn/lzma/tree/f164df92d83e095f195d628b1a68a141ae2eb638)、[dlv](https://github.com/developit/dlv/tree/e636db817a96e4ca4710b407163fb992748b3b80)、[saxes](https://github.com/lddubeau/saxes/tree/211fa0ebec9b628affc09219199639887174bfc3)、[stackback](https://github.com/defunctzombie/node-stackback/tree/2963095372abf7b75ba55f01cef08ab1e62c2ff4)。

## 离线检查

### esbuild 原生与 WASM 补充

`npm-esbuild-build-evidence.json` 关联上述清单中的 26 个精确归档，不新增或升级依赖：

- **23 个原生发行包**：静态读取 Go 内嵌构建信息，观察到 `go1.23.12`、esbuild 提交 `208f539945b145e7c9d6d844290f81c3fe5af320`、`vcs.modified=false`、`CGO_ENABLED=0`；保留各自执行文件的哈希、大小、信息偏移和原始模块记录。这里记录的是发布者嵌入的内容，**没有复现构建，也没有执行这些文件**。
- **3 个 JavaScript/WASM 发行包**：`android-arm`、`android-x64`、`openharmony-arm64` 的 `bin/esbuild` 是 Node 加载脚本，不是原生可执行文件。每包的 `bin/esbuild`、`wasm_exec.js`、`wasm_exec_node.js` 共 9 个文件分别与固定 esbuild/Go 提交的源文件逐字节一致。另记录 `esbuild.wasm` 的哈希；未取得与原生文件相同形式的内嵌构建记录，不把 WASM 字符串中出现的版本号当作完整编译来源。
- **不能统一套用模块依赖**：Android ARM64、Darwin、FreeBSD、Linux 原生记录包含 `golang.org/x/sys` 的固定版本；AIX、NetBSD、OpenBSD、SunOS、Windows 的记录没有该模块。这里不推断它们的完整系统库闭包。
- **两份正文、两个固定来源**：`npm-esbuild-go-LICENSE.txt` 与 `npm-esbuild-go-PATENTS.txt` 同时匹配 Go `go1.23.12` 提交及 `x/sys` 对应提交的根文件，逐字节保留，不重复改写版权文字。这不表示根文件已经涵盖所有运行时、vendored 库或工具链内容，也不能替换父包原有许可证。

固定来源：[Go](https://github.com/golang/go/tree/dd8b7ad9268c2fbde675132a41b4e4da02eef94d)、[x/sys](https://github.com/golang/sys/tree/c0bba94af5f85fbad9f6dc2e04ed5b8fac9696cf)。原生内嵌信息的编码依据为 [Go buildinfo 源码](https://go.dev/src/debug/buildinfo/buildinfo.go)；WASM 未按该原生读取器验证，不混用两种证据。

### 检查命令

在仓库根目录运行：

```bash
python deploy/scripts/check_npm_license_supplement.py
python deploy/scripts/check_esbuild_distribution_evidence.py
```

第一项检查精确锁、55 个发行包与全部对应安装路径、源提交关联、文本完整性和未完成审查标记。第二项先执行第一项，再核对 26 个 esbuild 包的关联、原生/WASM 分类、平台模块观察、9 个加载脚本匹配及两份 Go 归属正文。检查原生元数据不能把 WASM 提升为编译已核实，检查局部许可证也不能提升为发行批准。锁文件按 LF 计算哈希，适应 Git 的元数据换行转换；许可正文固定 LF 并逐字节核对。升级依赖或改变锁后，必须重新取证，不能只更新哈希来取得通过。

检查不联网重新验证归档或签名，也不能防止正文与清单被同时伪造。它不验证完整源码编译、不判断许可证兼容性、不替代项目许可证的权利人决策。其余 npm 包、Python、字体/图标、素材、系统库与原生工具链仍须按[依赖审查流程](../dependency-review.zh-CN.md)完成整个候选版本的审查。
