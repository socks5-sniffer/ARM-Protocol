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

## Reporting a Vulnerability

If you discover a security vulnerability within ARM, please do not disclose it publicly.

Instead, please open a [GitHub Security Advisory](https://github.com/socks5-sniffer/ARM-Protocol/security/advisories/new) in this repository, or contact the maintainer via GitHub.

Please include:
- A description of the vulnerability.
- Steps to reproduce the issue.
- Any potential mitigation strategies if you have them.