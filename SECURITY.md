# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Contact the repository
maintainers privately and include the affected revision, reproduction steps,
impact, and any suggested mitigation. Do not include production credentials or
personal data in the report.

- Private security report channel: `rongyansuanli@163.com`
- Official company site: <https://www.rongyansuanli.com>

Use the subject prefix `[SceneGo Security]`. If the report contains sensitive
material, first request a secure transfer method and do not attach credentials,
private user media, or production data to the initial message.

Receiving responsible vulnerability reports is separate from technical support.
The public source edition includes no installation, configuration, deployment,
upgrade, incident response, debugging, customization, availability, or response-
time commitment. Commercial support may be discussed only through the official
contact channel documented in
[docs/open-source/support-policy.zh-CN.md](docs/open-source/support-policy.zh-CN.md).

## Credential handling

- Configure provider keys, database passwords, signing secrets, and worker tokens
  through environment variables or an external secret manager.
- Example files must contain placeholders that cannot authenticate.
- Rotate a credential immediately if it is committed, logged, or shared in a
  public artifact. Deleting it from the latest revision is not sufficient; the
  repository history must also be cleaned before publication.

## Supported releases

Security fixes target the current `main` branch. See
[docs/open-source/security-release-checklist.zh-CN.md](docs/open-source/security-release-checklist.zh-CN.md)
for the mandatory release gates used for subsequent updates.
