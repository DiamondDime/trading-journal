# Security policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security problems.

Use GitHub's private vulnerability reporting:

[https://github.com/&lt;owner&gt;/crypto-journal/security/advisories/new](https://github.com/<owner>/crypto-journal/security/advisories/new)

(Replace `<owner>` with the GitHub account that hosts the repo. The link is live once the repo is published.)

You can expect:

- Acknowledgement within 72 hours.
- An initial assessment within 7 days.
- Coordinated disclosure once a fix is available, with credit to the reporter unless anonymity is requested.

If GitHub Security Advisories is unavailable to you, open an empty issue titled "security contact request" with no detail — a maintainer will reach out to coordinate a private channel.

## Threat model

This is a self-hosted single-user product. The threat model assumes the operator controls the host. Specific risks we explicitly defend against:

- **Exchange API-key compromise via stored ciphertext.** Mitigation: every credential field is encrypted with AES-256-GCM before insert (`src/lib/crypto/credentials.ts`, mirrored in `worker/csj_worker/crypto.py`). The master key lives in the `CREDENTIALS_MASTER_KEY` env var, not in the database. Adapters reject keys that grant withdraw permission at `connect()` so a compromised database alone cannot drain funds.

- **Self-hosted database compromise.** Mitigation: credentials are at-rest encrypted (see above). Row-level security policies on every user-data table provide a second layer if Postgres is exposed to a less-privileged role. The shim role used in single-user mode bypasses RLS as superuser; if you expose the database to anything else, use a dedicated `authenticated`-role connection string.

- **Prompt injection through user-typed notes / postmortems.** Mitigation: note bodies are stored verbatim but rendered through the standard React escape path — never inserted as HTML. We do not pipe note text through an LLM in v1; if that changes, this section will be updated.

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
