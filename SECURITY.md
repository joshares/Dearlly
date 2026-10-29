# Security

## Reporting a problem

Please do not open a public issue for security problems. Use GitHub's private reporting instead:
**Security** tab → **Report a vulnerability**. We aim to reply within 3 working days.

Once the Dearlly domain and inbox are live, security reports can also go to `hello@` on that domain.

## What we follow

Dearlly targets **OWASP ASVS Level 2**. The full standard is in `docs/project-playbook.md` (section 3)
and the Dearlly additions are in `docs/build-plan.md` ("Security, privacy and safety"). In short:

- Secrets come from the environment only, are never committed, and never appear in logs.
- Production refuses to start with insecure settings (plain `http://` origins, `*` CORS, wildcard hosts,
  default secrets) and turns off the API docs.
- Every response carries strict security headers; every request gets a request ID.
- Containers run as non-root with read-only filesystems, no new privileges and all capabilities dropped.
  Ports are bound to `127.0.0.1`; only the reverse proxy is public.
- Every pull request runs lint, type checks, tests, dependency audits (hash-locked Python, `npm ci`),
  gitleaks, Semgrep, CodeQL and Trivy. All GitHub Actions are pinned to commit SHAs.
- Private links use unguessable tokens (at least 128 bits), are `noindex` and can be revoked.
- Data handling follows the Nigeria Data Protection Act 2023.
