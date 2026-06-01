# Security Policy

## Supported Versions

Currently, the `main` branch of ARM is the only supported version for security updates.

## 🔑 API Key Safety (Crucial)

**ARM is a client-side React research prototype (Vite + React 18).**

API calls to three LLM providers are made at runtime — Anthropic (Claude), OpenAI (GPT-4o-mini), and Google (Gemini 2.5 Flash).

**Dev environment (local only):**
The Vite dev server includes a proxy layer (`vite.config.js`) that routes `/api/anthropic` and `/gemini` through the local server, keeping API keys out of the browser network tab during development. Keys are loaded from `.env` via `VITE_*` environment variables.

- **NEVER commit your `.env` file or hardcode any API key into source code.** All three keys (`VITE_ANTHROPIC_API_KEY`, `VITE_OPENAI_API_KEY`, `VITE_GEMINI_API_KEY`) must stay in `.env` which is excluded by `.gitignore`.
- **Production / public hosting warning:** The Vite proxy is a dev-only tool. If you build and deploy to a public host (Vercel, Netlify, GitHub Pages, etc.), API keys injected as `VITE_*` variables will be visible in the compiled bundle. **Do not deploy publicly without first moving all API calls to a secure backend proxy** (e.g., an Express.js server, Next.js API routes, or serverless functions).
- Set strict spend limits and usage caps in each provider's dashboard while developing locally (Anthropic, OpenAI, and Google AI Studio all support this).

## 🚪 Production Proxy (`server.js`)

The OpenShift / container build (`Containerfile` + `server.js`, run via `npm start`) serves the
built SPA and proxies the three provider APIs server-side, so keys live only in the runtime
environment — not in the browser bundle. The Vite proxy described above is **dev-only**; `server.js`
is the production path.

Because that proxy spends the operator's API budget on every request, it is **authenticated and
fails closed**:

- **`ARM_ACCESS_TOKEN` (required for public deployments).** All `/api/*` requests must present this
  shared secret as an `x-arm-token` header (or `Authorization: Bearer …`). If the variable is unset,
  the proxy is **disabled** and returns HTTP 503 — preventing an open, anonymous "denial-of-wallet"
  endpoint. Generate one with `openssl rand -hex 32`, set it in the deployment secret, and enter the
  same value in the app's **access token** field (stored in `localStorage`, never compiled into the
  bundle). The token is stripped before requests are forwarded upstream.
- **`TRUSTED_PROXY_COUNT` (default `1`).** Controls how the real client IP is resolved from
  `X-Forwarded-For` for rate limiting. Only the right-most entries — those appended by infrastructure
  you trust (e.g. the OpenShift router) — are used; client-supplied left-most entries cannot be forged
  to escape the limiter. Set to `0` if the server is exposed directly with no reverse proxy.
- **Per-IP rate limit** (300 requests / 60 s) applies to every route as a backstop.

Even with the gate in place, keep provider-side spend limits enabled as defense-in-depth.

## Reporting a Vulnerability

If you discover a security vulnerability within ARM, please do not disclose it publicly.

Instead, please open a [GitHub Security Advisory](https://github.com/socks5-sniffer/ARM-Protocol/security/advisories/new) in this repository, or contact the maintainer via GitHub.

Please include:
- A description of the vulnerability.
- Steps to reproduce the issue.
- Any potential mitigation strategies if you have them.