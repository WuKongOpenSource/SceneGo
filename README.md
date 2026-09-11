# SceneGo · 创剧

SceneGo（创剧）is an AI-assisted video production workspace. It organizes a
project from script and visual design through storyboard, audio, video
generation, and final delivery while preserving user choices and generation
history.

SceneGo is an [Ostory 故事星](https://www.ostory.ai) product developed by
[深圳熔岩算力科技有限责任公司 / Shenzhen Lava Computing Power Technology Co., Ltd](https://www.rongyansuanli.com/).

## Online experience / 在线体验

Hosted experience: [https://tv.ostory.ai](https://tv.ostory.ai)

在线体验与本仓库的自行部署版本是两种交付形态，功能版本、可用模型和服务配置可能不同。
首次使用时：

1. 打开在线地址，在登录页点击“创建账号”。
2. 使用中国大陆手机号，完成滑块验证并获取 6 位短信验证码；设置密码即可注册，邮箱可稍后绑定。
3. 注册后可使用手机号和密码登录，也可以使用短信验证码登录。
4. 新建项目和分集后，可按“创意 → 剧本 → 角色与场景 → 分镜 → 画面与视频 →
   配音与字幕 → 剪辑与成片”的流程体验，也可以进入“自由创作”画布自由组合素材。

在线生成能力取决于平台当前启用的模型、账号点数和第三方服务状态。请只上传或生成已取得
必要权利的内容。

### Main features / 主要功能

- 管理项目、分集和创作版本，保留生成历史与用户选择。
- 创建和迭代剧本，管理角色、场景、道具及项目素材。
- 生成分镜与候选画面，并明确选择用于后续制作的版本。
- 生成和管理配音、音乐、音效与字幕。
- 使用首帧、尾帧或参考素材生成视频，也可导入已有视频继续制作。
- 在时间线中完成剪辑、美化、转场、音频混合和成片输出。
- 使用“自由创作”无限画布连接剧本、图片、音频和视频节点，快速尝试不同创意链路。

## Design principles

- Generated media is a **candidate take**. A user's selected take is explicit
  state and must never be overwritten by a late asynchronous result.
- Upstream edits create **stale markers** for affected downstream content. They
  do not delete media or automatically spend credits on regeneration.
- Asset bindings use **project defaults with shot-level overrides** and are
  resolved immediately before a generation task is submitted.
- Storyboard entities carry stable **lineage identifiers**, allowing results to
  attach safely after a storyboard revision.
- AI script edits are represented as structured patches and require user review
  before they become the active version.

The detailed contracts live in [docs/architecture/overview.md](docs/architecture/overview.md)
and [docs/architecture/content-workflow.md](docs/architecture/content-workflow.md).
Release and maintenance requirements are documented in the
[security release checklist](docs/open-source/security-release-checklist.zh-CN.md).

## Public source edition

This public edition is source-only. It does not include container files,
prebuilt applications, release archives, deployment/install/upgrade helpers, or
project-developed ComfyUI agents, workflows, nodes, and GPU deployment tooling.
Users must install middleware, configure providers, compile both frontends, and
operate their own infrastructure.

Compilation follows the commands in the deployment guide. Standard compiler
configuration, dependency lockfiles, application migrations, and test tools
remain source inputs; no script assembles or provisions a deployment.

Start with the Chinese [public-edition guide](docs/open-source/README.zh-CN.md),
then follow its deployment, configuration, provider, ComfyUI boundary,
security, and support documents in order. The community license does not
include technical support. Commercial implementation, the SceneGo Commercial License (MCL),
or support may be requested through [Ostory](https://www.ostory.ai) or
[Shenzhen Lava Computing Power Technology Co., Ltd](https://www.rongyansuanli.com/).

## Repository layout

- `deploy/`: FastAPI backend, workers, migrations, operational tooling, and tests.
- `deploy/new_html/`: main React application.
- `studio/`: free-creation canvas that reuses the public application services.
- `docs/`: current architecture, contributor, deployment, and product guidance.

## Local development

Backend requirements depend on the enabled providers. Public-edition users must
follow the [SceneGo open-source deployment guide](docs/open-source/manual-installation.zh-CN.md)
and [configuration reference](docs/open-source/configuration-reference.zh-CN.md)
and must create their own local configuration. Never add real credentials to
the repository.

Frontend:

```bash
cd deploy/new_html
npm install
npm run dev
```

Verification:

```bash
cd deploy/new_html
npm run typecheck
npm test -- --run
npm run build:public

cd ../../studio
npm run typecheck
npm test
npm run build:public

cd ..
python -m pytest -q deploy/tests
python deploy/scripts/check_public_route_authorization.py
python deploy/scripts/check_code_comment_language.py
python deploy/scripts/check_open_source_hygiene.py
python deploy/scripts/check_public_import_boundary.py
python deploy/scripts/check_public_frontend_boundary.py --dist-root deploy/dist --studio-dist-root studio/dist
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Security issues
must follow [SECURITY.md](SECURITY.md) rather than a public issue.

We strongly request that community modifications start from a GitHub Fork of
[WuKongOpenSource/SceneGo](https://github.com/WuKongOpenSource/SceneGo) and that
generally useful changes be submitted back as pull requests. This is an upstream
collaboration request, not an additional condition on the rights granted by the
AGPL.

## License

SceneGo uses a dual-license model. The public community edition is available
under the [GNU Affero General Public License v3.0 only](LICENSE)
(`AGPL-3.0-only`). Organizations that need proprietary commercial terms,
including closed-source modification or distribution, embedding in a closed
product, or operating a hosted service without fulfilling AGPL obligations,
must obtain a separately signed SceneGo Commercial License (MCL); see
[COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md). SceneGo, 创剧, Ostory, 故事星,
and their logos remain protected names and marks; see [TRADEMARKS.md](TRADEMARKS.md).
Third-party components remain subject to their own licenses as described in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the dependency evidence.
