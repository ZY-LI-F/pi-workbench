# Security policy

## Reporting

Please report security issues privately through the repository's GitHub
security advisory flow. Do not include API keys, OAuth tokens, private project
files, or Pi session contents in a public issue.

## Runtime boundaries

- The renderer is sandboxed and uses a narrow preload API.
- Project paths, task identities, session paths, provider inputs, webhook
  payloads, and persisted Board data are validated in the Electron main
  process.
- Webhooks bind only to `127.0.0.1` and require an unguessable per-rule token.
- Credentials remain in Pi's standard user configuration; release packages do
  not contain developer credentials.
- Workspace access is an application policy and serialization boundary, not an
  operating-system sandbox.

## Dependency audit status (2026-08-01)

The repository pins the latest verified Pi release
`@earendil-works/pi-coding-agent@0.83.0`. Its published
`npm-shrinkwrap.json` still pins `brace-expansion@5.0.7`, which npm reports for
GHSA-mh99-v99m-4gvg; the patched release is `5.0.8`. Root npm overrides cannot
replace a dependency locked by a
published child shrinkwrap. The remaining audit item is therefore exposed
here explicitly instead of being hidden with `npm audit --force`, a Pi fork,
or an install-time mutation of `node_modules`.

All other audit findings present before the v0.3.0 hardening pass were removed
through compatible dependency updates and exact root overrides. Release
validation must continue to run `npm audit`, `npm run check`, production build,
and packaged smoke tests; a new Pi release must be contract-tested before its
exact version changes.
