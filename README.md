# ARM Cross-Model Fresh Repo

Minimal Vite + React app for ARM v0.6 cross-model runs (Claude/GPT/Gemini in UI).

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in API keys.
3. Install deps and run:

```bash
npm install
npm run dev
```

## Required env vars

- `VITE_OPENAI_API_KEY`
- `VITE_GEMINI_API_KEY`
- `VITE_ANTHROPIC_API_KEY`

Optional:

- `VITE_ANTHROPIC_MODEL` (default `claude-sonnet-4-6`)
- `VITE_TOKENS_R1` (default `5000`)
- `VITE_TOKENS_R2` (default `6500`)
- `VITE_TOKENS_GAMMA` (default `8000`)

## Notes

- Anthropic requests are proxied through Vite via `/api/anthropic/*`.
- OpenAI is called directly from the browser.
- Gemini calls are proxied through `/gemini/*`.
