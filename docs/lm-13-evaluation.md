# LM-13: local-model release evaluation

This is an **evaluation protocol**, not a claim that the bundled Qwen3.5 9B model has passed on real hardware. Issue [LM-13](https://github.com/herringvoices/llm-ttrpg/issues/58) remains open until the full deterministic matrix, compatibility evidence, and representative human-scored local sessions pass.

## Reproducible benchmark workflow

1. On a local machine with the desktop runtime and a **throwaway/test campaign** ready, run the existing live replay script using `REPLAY_DATABASE_PATH`, `REPLAY_WORLD_ID`, `REPLAY_ENDPOINT`, `REPLAY_API_KEY`, and `REPLAY_TRACE_PATH` (see `scripts/live-replay-session.ts`). Note that the existing raw trace **contains sensitive prompts, responses, transcripts and canonical state**. Keep it local, out of version control, and delete it after extracting your observations.
2. Generate an allowlisted report: `node scripts/lm13-benchmark-report.mjs path/to/raw-trace.json path/to/report.json`.
3. For candidate vs baseline, pass a third argument: `node scripts/lm13-benchmark-report.mjs candidate-trace.json candidate-report.json baseline-report.json`. Both reports must use the same version.
4. Record the exact baseline/candidate commit, scenario, test-world seed, model file/hash, quantization, runtime revision, context/output token settings, CPU, RAM, sampling parameters, cold/warm startup, run count, and any differing configuration **outside the automatically generated report**. The generator can see the analysis host, not prove where the trace was captured.
5. Repeat each scenario across multiple runs with equivalent initial worlds. Keep scripted CI results and real local-model runs separate. For meaningful sample sizes report median and p90/p95, never infer those percentiles from one run.

The generated JSON omits raw declaration text, player/NPC transcript bodies, model prompt/response bodies, API keys, private notes, world state, actor IDs and world IDs. It measures invocation count and the sum of per-call provider durations; it **does not measure end-to-end latency**, token usage, canonical correctness or gameplay quality. Missing measurements are `null`, never zero. Don't share the original trace.

## Human gameplay scoring form

Record one form per run, using a fresh or restored equivalent world. Score each criterion **0 = unacceptable, 1 = significant issue, 2 = acceptable, 3 = good, 4 = excellent**, citing turn numbers and sanitized observations. Do not paste secret GM data or player-private inputs into published evidence.

| Criterion | Score (0–4) | Notes / turn reference |
| --- | --- | --- |
| Player agency and speech fidelity | | |
| Checks, time, pressure, and power authority | | |
| Spatial and temporal continuity | | |
| NPC knowledge boundaries and distinct voice | | |
| Second-person present perspective and observational clarity | | |
| Proportional prose and useful player handoff | | |
| Open-ended creative action handling | | |
| Save/reopen and recovery | | |

**Any observed hard-gate violation blocks release, regardless of average score.** Record as failure and attach a redacted minimal reproduction: fabricated player commitment/choice, secret leakage, unauthorized canonical change, skipped interruption, duplicate RNG/effect, damaged save, duplicate first power, or reference-game coupling.

## Required manual matrix

- Routine look, breakfast, wait, and move-then-speak; check unnecessary invocation/canon growth.
- 10–20 turns of conversation, then a promise/trade; check voice, hidden knowledge, and durable commitments.
- Creative improvised action (torch/crate) and compound high-pressure rescue with interruption.
- Pressure 1 multi-hour search versus pressure 9 short attempt.
- Enter a new place, meet an NPC, leave, revisit after significant fictional time and reopen save.
- Ignore suggested plot; verify no forced quest and no fabricated player intention.
- Creature incident, strange magical phenomenon, and mundane first-power opening; power should appear through meaningful turns 1–3, not during initial generation.
- Resume legacy campaign and interrupted legacy draft; retry narration after a committed effect without repeating it.
- Malformed/truncated output, runtime absent/timeout, stale world, and concurrent realization.
- Alternate fantasy package and cases with same-name characters, hidden NPC facts and restrictive player biography.

## Rollout/rollback decision record

| Path | When it is safe | Action on failure |
| --- | --- | --- |
| Prompt/brief/routing compatibility flag | No persisted contract change and old handler accepts current state | Switch known-good path, mark diagnostics and rerun |
| Reader-compatible code rollback | Old build demonstrably reads every record produced by new build | Restore pinned build after snapshot; verify live load/replay |
| New storage representation not readable by old build | **Not safe to binary downgrade** | Block rollback; forward-fix reader or use a tested migration/export |
| Authority or privacy failure | Never promote | Stop rollout, preserve canonical commits, add regression and rerun local case |

Do not assume that a flag reverses a schema change. Record flags, schema version, migrations, baseline commit and outcome in release notes. No analytics service or network reporting is required.

## Evidence checklist

- [ ] `npm run check` green on exact candidate commit
- [ ] Deterministic scenario matrix and fault injection pass
- [ ] Legacy campaign, draft and pending-action compatibility fixtures pass
- [ ] Existing fantasy package still works
- [ ] Baseline and candidate sanitized multi-run benchmark reports attached
- [ ] Bundled Qwen3.5 9B Q4_K_M evaluated through actual offline desktop/llama.cpp path on CPU
- [ ] Human scoring forms with sample counts and all hard-gate findings reviewed
- [ ] Candidate canary, known-good path, and rollback reader compatibility demonstrated

Completing the script and this protocol is **only partial LM-13 implementation**. Neither scripted tests nor an Ollama smoke test substitute for real bundled-model play.
