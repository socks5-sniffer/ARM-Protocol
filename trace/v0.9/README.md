# trace/v0.9 — ARM v0.9 matched-panel runs

## What's here

Ten runs on the q200 question (AI autonomous network severance dilemma) across the full
CFAAq2 factorial grid: 4 provider configs × roles/no-roles × silent-baseline variants.

| File pattern | Panel | Notes |
|---|---|---|
| `arm-v0.9-q200-CGG-*` | Claude / GPT / Gemini (xCGG) | roles, no-roles, alphaSilent, betaSilent variants |
| `arm-v0.9-q200-allClaude-*` | Claude × 4 | monoculture control |
| `arm-v0.9-q200-allGpt-*` | GPT × 4 | monoculture control |
| `arm-v0.9-q200-allGemini-*` | Gemini × 4 | monoculture control |

## Model panel (matched mid/fast tier)

- Alpha/Claude: `claude-sonnet-4-6`
- GPT: `gpt-5.5-2026-04-23` (dated API snapshot)
- Gemini: `gemini-3.5-flash`
- Embeddings: `text-embedding-3-small` (OpenAI)

## Schema

All files: `schema_version: arm-trace-v1.2` · `arm_version: "0.9"`

**Provenance note:** 9 of the 10 files were generated during PR20 development, before
`ARM_VERSION` was flipped to `"0.9"` in `src/config.js`, so their original autosave
filenames carried the `v0.8` prefix. They were renamed in PR21 because their *content*
is fully v0.9 — matched-panel models, arm-trace-v1.2 schema, q200 question. The
`arm_version: "0.9"` field was backfilled at the same time to make the folder uniform.
The 10th file (`CGG-roles-betaSilent-…`) was produced after the merge and already
carried the field natively.
