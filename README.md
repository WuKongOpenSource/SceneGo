# SceneGo · 创剧

SceneGo（创剧）is an AI-assisted video production workspace. It organizes a
project from script and visual design through storyboard, audio, video
generation, and final delivery while preserving user choices and generation
history.

SceneGo is an [Ostory 故事星](https://www.ostory.ai) product developed by
[深圳熔岩算力科技有限责任公司](https://www.rongyansuanli.com).

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
include technical support. Commercial implementation, proprietary licensing,
or support may be requested through [Ostory](https://www.ostory.ai) or
[Rongyan Computing](https://www.rongyansuanli.com).

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

## License

The community edition is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`).
Separate commercial licensing is available; see
[COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md). SceneGo, 创剧, Ostory, 故事星,
and their logos remain protected names and marks; see [TRADEMARKS.md](TRADEMARKS.md).
Third-party components remain subject to their own licenses as described in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the dependency evidence.
