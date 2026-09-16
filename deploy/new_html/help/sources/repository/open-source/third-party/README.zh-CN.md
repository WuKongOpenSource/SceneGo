# 第三方许可缺件补充证据（局部）

本目录分开记录 [npm 的 55 个许可缺件包](npm-review.zh-CN.md)与下文的 Python 证据。两份清单都不是完整 SBOM，也不批准整个项目发行。

## Python 许可缺件

以下 Python 清单只覆盖当前 Python 锁文件中 **7 个发行物未附独立 LICENSE/COPYING/NOTICE 文件的依赖**。不是完整 SBOM，不是项目许可证，也不表示已经获得完整发行审查批准。未修改依赖代码或替换业务实现。

`python-license-supplement.json` 记录精确版本、两个平台的安装归档哈希、PyPI 源码归档 URL 和 SHA-256、上游固定提交、逐模块 SHA-256、许可来源及尚待复核项。原始安装日志和环境信息不纳入公开资料。

| 包 | 版本 | 补充许可依据 | 固定提交源码核对 |
| --- | --- | --- | --- |
| alibabacloud-credentials | 1.0.12 | 本版本 README 的 Apache 2.0 链接和版权声明 | 28/28 模块一致 |
| alibabacloud-credentials-api | 1.0.1 | 对应上游仓库根 LICENSE | 2/2 模块一致 |
| alibabacloud-gateway-spi | 0.0.4 | 对应上游仓库根 LICENSE | 3/3 模块一致 |
| alibabacloud-tea | 0.4.3 | 本版本 README 的 Apache 2.0 链接和版权声明 | 历史提交未定位，8 个模块未建立对应 |
| alibabacloud-tea-openapi | 0.4.6 | 本版本 README 的 Apache 2.0 链接和版权声明 | 23/23 模块一致 |
| alibabacloud-tea-util | 0.3.15 | 对应上游仓库根 LICENSE；另保留 README 声明 | 3/3 模块一致 |
| darabonba-core | 1.0.9 | 本版本 README 的 Apache 2.0 链接和版权声明 | 24/24 模块一致 |

## 如何理解证据

- 源码归档从 PyPI 下载并验证 SHA-256；没有解包执行其中代码。6 个包共 83 个 Python 模块与固定提交的原始文件逐字节比较一致。这里不是“找到对应版本 tag”，也不证明仓库其他语言或文件都属于该发行物。
- `alibabacloud-credentials-api` 的发行元数据把主页填为 gateway 仓库；实际模块与[独立官方仓库](https://github.com/aliyun/alibabacloud-credentials-api)匹配。清单同时保存原主页与核实后的来源，不能只按包主页抓取许可证。
- `licenses/` 中的三份上游根 LICENSE 按各自固定提交保存，检查 Git blob 和 SHA-256；其余声明明确引用的[Apache 2.0 正文](https://www.apache.org/licenses/LICENSE-2.0.txt)单独保存。不能把别的语言目录里的 LICENSE 套用到 Python 包。
- `declarations/` 保留 5 个发行包 README 的 License 段落内容，清单记录完整 README 的哈希。它们是版本内的许可声明，不是假称该发行包原本附带许可证正文。完整 README 中的徽章链接等无关内容没有复制。
- Tea 0.4.3 的许可声明来自已锁定的源码归档；当前上游树已使用另一模块布局，未据此断言旧代码与当前仓库一致。清单里的提交仅是已检查的树，不是已确认的旧版本提交。
- 元数据中的作者和联系邮箱是第三方归属资料，必须保留。没有发现独立 NOTICE 不等于整个依赖树都不存在归属义务，也不能自行编造 NOTICE。

## 维护与验证

在仓库根目录运行：

```bash
python deploy/scripts/check_python_dependency_locks.py
python deploy/scripts/check_python_license_supplement.py
```

检查离线运行：验证当前版本和安装归档是否仍与两个原生锁一致、文件是否缺失或被修改、模块计数和证据类型是否改变。许可证正文固定 LF；修改锁或升级 SDK 后须重新取证。检查不会联网重新证明来源，也不能防止恶意同时伪造正文和清单。

发行前仍须把其余 Python、Node、系统/原生库、字体、图标和示例素材纳入完整清单，并复核适用的版权/NOTICE 保留要求。Apache 2.0 的再分发要求见[官方正文第 4 节](https://www.apache.org/licenses/LICENSE-2.0.txt)；项目权利人仍需决定项目本身的许可证。这个局部检查通过不能放行整个公开发行。
