# HEALOSBENCH — Eval Harness Notes

## Overview
Built an LLM evaluation harness to compare three prompting strategies 
(zero_shot, few_shot, cot) for extracting structured medical data 
from doctor-patient transcripts. Evaluated across 50 synthetic cases 
using per-field metrics appropriate to each field type.

## How to Run

Mac/Linux:
bun install && bun run eval -- --strategy=zero_shot

Windows PowerShell:
bun install
bun run eval -- --strategy=zero_shot

## Results

| Strategy  | avgOverallScore | avgFinalScore | avgHallucinationPenalty | Cases |
|-----------|----------------|---------------|------------------------|-------|
| zero_shot | 0.8897         | 0.8809        | 0.0088                 | 50    |
| few_shot  | 0.9377         | 0.9349        | 0.0028                 | 50    |
| cot       | 0.9868         | 0.9864        | 0.0004                 | 50    |

## Winner: Chain-of-Thought (CoT)

CoT outperformed all strategies across every metric. Most striking 
was the hallucination reduction — CoT produced 22x fewer 
hallucinations than zero_shot. Forcing the model to reason 
step-by-step before extracting values appears to ground it more 
firmly in the transcript text.

## Per-Field Insights

- chief_complaint: all strategies scored well — it's usually 
  explicit in the transcript
- medications: biggest variance between strategies — CoT normalized 
  dose/frequency better (BID vs twice daily)
- vitals: high accuracy across all — numbers are unambiguous
- diagnoses: few_shot and cot both benefited from examples showing 
  ICD10 format
- plan: zero_shot occasionally hallucinated extra steps not in transcript

## What Surprised Me

- Few-shot jumped +5% over zero_shot just from examples — 
  confirming that format demonstration matters as much as instruction
- CoT's hallucination rate (0.0004) is remarkably low — nearly 
  every predicted value was traceable to transcript text
- zero_shot still scored 88.9% — Gemini Flash handles medical 
  extraction reasonably well even without guidance

## What I'd Build Next

- Per-field score breakdown in the compare view
- Cost tracking per run (tokens × price)
- Active learning: surface the 5 cases with highest strategy disagreement
- Prompt versioning with content hash so regressions are traceable

## What I Cut

- Postgres/Drizzle persistence (using file cache instead)
- SSE streaming (not implemented)
- Prompt caching (Anthropic API billing was unavailable during 
  assessment window; Gemini Flash used as drop-in replacement. 
  All infrastructure is model-agnostic and would work identically 
  with Claude Haiku including prompt caching via cache_read_input_tokens)

## Structured Output

Gemini's responseMimeType: "application/json" with schema validation 
enforces structured output without raw JSON.parse on model text. 
In the Anthropic implementation, this would use tool use with 
input_schema matching schema.json.

## Prompt Caching

Anthropic prompt caching (cache_read_input_tokens) could not be 
implemented as Gemini Flash was used as a drop-in replacement. 
In the Anthropic implementation, system prompt + few-shot examples 
would be marked with cache_control: {type: "ephemeral"} and 
cache_read_input_tokens would be tracked per run and surfaced 
in the dashboard. File-based caching achieves the same cost 
reduction goal by skipping repeat API calls entirely.

## API Note

Anthropic API billing could not be completed during the assessment 
window. Google Gemini Flash was used as a drop-in replacement. 
The extractor, evaluator, runner, and cache are fully model-agnostic.