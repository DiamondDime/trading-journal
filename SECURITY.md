# Security policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security problems.

Email `security@example.com` with:

- A short description of the problem.
- Steps to reproduce, or a proof-of-concept where it's safe to share one.
- The flavor affected — desktop, webapp, or both.
- The version or commit SHA.

If you'd rather use GitHub's private vulnerability reporting instead, that channel is also monitored:

[https://github.com/skywalqr/crypto-spread-journal/security/advisories/new](https://github.com/skywalqr/crypto-spread-journal/security/advisories/new)

### Response time

- **Acknowledgement**: within 7 days of receipt.
- **Initial assessment**: within 14 days. We'll tell you whether we consider the report in scope, the rough severity, and an expected fix window.
- **Coordinated disclosure**: once a fix is available. Credit to the reporter unless anonymity is requested.

### Bug bounty

None currently. We're a pre-v1 open-source project. Credit and a public thank-you in the changelog and release notes is what we can offer.

## Scope

### In scope

- Authentication and session handling in the webapp.
- The single-user `APP_USER_ID` shim and any path that bypasses it.
- The AES-256-GCM encryption layer for exchange credentials (`src/lib/crypto/credentials.ts`, mirrored in `worker/csj_worker/crypto.py` and `worker-ts/src/crypto.ts`).
- Withdraw-permission rejection in adapter `connect()` calls.
- Server Actions and API routes under `src/app/api/`.
- The Electron main process, IPC surface, and the PGlite connection string handling.
- Auto-update verification (signature, channel, downgrade resistance).
- Row-level security policies on user-data tables.
- The Markdown rendering path for notes and postmortems.

### Out of scope

- Third-party exchange APIs we don't control. If Binance leaks your key, that's not us — but if our code leaks it through a log, that absolutely is.
- Vulnerabilities in upstream dependencies that don't reach our code paths.
- Social-engineering attacks on operators.
- Denial-of-service against a self-hosted instance the attacker doesn't operate.
- Browser bugs in Electron's bundled Chromium that have been patched upstream — please report those to the [Chromium project](https://www.chromium.org/Home/chromium-security/reporting-security-bugs/).
- Findings that require an attacker to already control the host (file system, OS keychain, running processes).

## Threat model

This is a self-hosted single-user product. The threat model assumes the operator controls the host. Specific risks we defend against:

- **Exchange API-key compromise via stored ciphertext.** Mitigation: every credential field is encrypted with AES-256-GCM before insert. The master key lives in `CREDENTIALS_MASTER_KEY` (webapp) or the OS keychain (desktop), not in the database. Adapters reject keys with `withdraw` scope at `connect()` time so a stolen database alone cannot drain funds.

- **Self-hosted database compromise.** Mitigation: credentials are at-rest encrypted. Row-level security policies on every user-data table provide a second layer if Postgres is exposed to a less-privileged role. The shim role used in single-user mode bypasses RLS as superuser; if you expose the database to anything else, use a dedicated `authenticated`-role connection string.

- **Prompt injection through user-typed notes / postmortems.** Mitigation: note bodies are stored verbatim but rendered through the standard React escape path — never inserted as HTML. We do not pipe note text through an LLM in v1; if that changes, this section will be updated.

- **Auto-update tampering on desktop.** Mitigation: electron-updater verifies the bundle signature against the Developer ID certificate before applying. Downgrade attacks are blocked by version-monotonic checks.

Not in scope for v1:

- Multi-tenant isolation (single-user-per-instance is the default).
- Hardened against a malicious host operator.
- SSO / federated identity.

## Operational guidance

- Rotate `CREDENTIALS_MASTER_KEY` only by re-encrypting all stored credentials — there is no key-versioning yet. Plan ahead.
- Back up `CREDENTIALS_MASTER_KEY` out-of-band. Losing it bricks every stored API key on that instance.
- Run the `web` and `worker` containers as the non-root users provided by the supplied Dockerfiles.
- Restrict the Postgres port (`5432`) to the Docker internal network in production. The default `docker-compose.yml` does not publish it.

## Supported versions

Pre-1.0; only the latest minor receives security fixes. Once a 1.0 ships this table will be filled in.

| Version | Supported |
|---|---|
| latest `main` | yes |
| anything else | no |
