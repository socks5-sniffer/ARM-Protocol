# xCGG-ARM-001 · Cross-Model ARM Experiment

**Alpha** = Claude Sonnet 4 (Anthropic)  
**Beta** = GPT-4o-mini (OpenAI)  
**Gamma** = Gemini 2.0 Flash (Google)  

No role injection. Neutral cross-model divergence test.  
7 sequential API calls. ~$0.30-0.50 per run.

## Setup

Requires **Node.js 18+** (uses native fetch).

```bash
# 1. Set your API keys
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=AIza...

# 2. Run
node run.js
```

## Custom question

```bash
node run.js --question "Your question here"
```

## Output

Results are written to `./results/xCGG-ARM-001_{timestamp}.json`

The JSON contains:
- Full R1 + R2 traces from all agents (with provider/model metadata)
- R1 convergence score (lexical Jaccard)
- Drift summary per agent
- Disagreement classification
- Per-call latency
- Raw responses for debugging

## What this tests

The single biggest credibility gap in ARM's current data: all prior runs
used Claude Sonnet for every agent role. This run splits agents across
three different model providers with different training pipelines (RLHF,
RLHF+RLAIF, etc.) to test whether:

1. R1 convergence drops (different priors → healthy independence)
2. Drift patterns differ across providers
3. Disagreement classification still functions cross-model
4. The protocol itself is model-agnostic

Even one run with this configuration transforms the narrative from
"possible RLHF artifact" to "testable hypothesis with preliminary evidence."

## Cost estimate

| Call | Agent | Provider | Max tokens | ~Cost |
|------|-------|----------|-----------|-------|
| 1 | Alpha R1 | Claude Sonnet | 2000 | ~$0.03 |
| 2 | Beta R1 | GPT-4o-mini | 2000 | ~$0.01 |
| 3 | Gamma R1 | Gemini Flash | 2000 | ~$0.01 |
| 4 | γ-Silent | Gemini Flash | 2000 | ~$0.01 |
| 5 | Alpha R2 | Claude Sonnet | 4500 | ~$0.08 |
| 6 | Beta R2 | GPT-4o-mini | 4500 | ~$0.02 |
| 7 | Gamma R2 | Gemini Flash | 5500 | ~$0.02 |
| **Total** | | | | **~$0.18** |

Actual cost depends on input token counts (system prompts + peer context).
Realistic total: **$0.20-0.40 per run**.
