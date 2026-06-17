# Security Policy

## Supported Versions

Currently, the `main` branch of ARM is the only supported version for security updates.

## 🔑 API Key Safety (Crucial)

**ARM is a client-side React research prototype (Vite + React 18).**

API calls to three LLM providers are made at runtime — Anthropic (Claude), OpenAI (GPT-4o-mini), and Google (Gemini 2.5 Flash).

**Dev environment (local only):**
The Vite dev server includes a proxy layer (`vite.config.js`) that injects the keys
**server-side** and routes `/api/anthropic`, `/api/openai` and `/api/gemini` through the
local dev server, keeping API keys out of the browser entirely. Keys are loaded from `.env`
using **plain, non-`VITE_`-prefixed** names (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GOOGLE_API_KEY` / `GEMINI_API_KEY`) — see `.env.example`.

- **NEVER commit your `.env` file or hardcode any API key into source code.** Keys must stay
  in `.env`, which is excluded by `.gitignore`.
- **Do NOT use `VITE_`-prefixed names for provider keys.** Anything `VITE_`-prefixed is inlined
  into the compiled browser bundle by Vite and would leak the key to every visitor. Use the
  plain names above so the keys stay server-side.
- **Production / public hosting:** Deploy via the server-side proxy (`server.js` / Containerfile,
  see below), which holds the keys in the runtime environment and never ships them to the browser.
  Do **not** deploy a static build that relies on `VITE_*` keys to a public host.
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