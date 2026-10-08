# LM-01 baseline: per-turn local-model diagnostics

Date: 2026-10-08. Related issue: https://github.com/herringvoices/llm-ttrpg/issues/46

## Measurement rules

The desktop turn observer covers every generate or consumed streamText invocation passed to its runtime: routing, player-action stages, NPC conversation, planner review, narration, and first-power generation. Each submitted turn receives a turn ID. Narration retries are separate lifecycle records, not part of the next submission. Campaign generation outside play is not included in turn measurements.

The current turn is at `view().diagnostics.performance`; the latest 20 sanitized performance entries are at `view().recentPerformance` or `session.recentPerformance()`. Set `diagnosticsEnabled: false` in the DesktopPlaySession initial configuration to turn this collection off. There are no diagnostic saves or telemetry uploads.

`totalWallMs` is elapsed submission-to-result time. `modelWorkMs` sums per-invocation wall durations (overlap counts twice) and must not be treated as exclusive latency. `elapsedProviderMs` is optional provider-reported duration. Token usage is optional and reported only when supplied; missing fields mean unavailable, never estimated or zero. `promptCharacters` counts serialized prompt characters but does not store any prompt. Failure type, phase, operation and schema ID are kept, but provider errors, raw completions, candidate outputs, private world text and credentials are not recorded. `attemptIndex` enumerates repeated calls to the same operation within the same turn.

`stateCounts.before`, `after`, and `delta` count entities, facts, beliefs, actor social states, documents, simulation cursors, mechanical realizations and events by authoritative event sequence. Delta is a net count change, not a complete record of edits. The old `growth` absolute after-counts remain for compatibility. No full event history is fetched solely to compute these counts.

## Scripted baseline

Run `npm run check` to exercise the fixed scripted model integration tests. The focused `tests/turn-diagnostics.test.ts` covers successes, invalid structured outputs, retries, thrown providers, stream completion and early termination, observer failure and sensitive-text exclusion. `tests/desktop-playable-loop.test.ts` verifies action model call accounting, failure outcome, zero-change state deltas, first-power lifecycle, conversation routing, and narration idempotency. `tests/action-pressure.test.ts`, `tests/player-action-pipeline.test.ts`, and `tests/resolution-rng.test.ts` cover adjacent mechanics.

Use the following declarations for a comparable manual play-through; each should be paired with an appropriate initialized scene and compared against the scripted invariants:

| Scenario | Declaration | Expected invariant |
| --- | --- | --- |
| Observation | I look around the room. | No invented authoritative discoveries |
| Routine | I sit down and eat breakfast. | Routine resolution without needless checks |
| Movement | I go into the kitchen. | Coherent location transition |
| NPC speech | I ask Mara what she saw. | Authorized recipient, no private leakage |
| Mixed | I approach Mara and ask what happened. | Movement and speech in order |
| Creative uncertainty | I throw my flashlight at the switch. | Preserve declared means; grounded check |
| Time pressure | I spend the morning searching for Jonny. | Bounded by authorized horizon |
| Power | I try using the strange ability I just gained. | Only established capabilities |
| Retry | Retry narration after committed action | No duplicate mechanics or events |

The existing scripted fixtures exercise the underlying action, conversation, pressure, opening and retry paths, but do not yet cover every exact sample declaration above as its own integration test. Scripted execution validates instrumented contracts, **not** natural-language quality or performance on a real local model.

## Manual opt-in bundled-model run

Start the desktop app in development mode with its bundled model configured as described in `docs/model-runtime.md`. Use disposable saves with the NPCs and scene conditions required above. Submit each scenario and inspect Development diagnostics. Record model version, hardware, context window, input/output token availability, wall/model-work milliseconds, call/failure counts, prompt characters, and before/after/delta counts. Check faithfulness to player intent, clarity, continuity, hidden-knowledge safety, pressure horizon, and duplicate-effect safety by hand. Repeat to estimate variability. Do not use another model to automatically grade the prose.

**Real bundled-model metrics: not measured in the implementation environment.** No GPU/model benchmark or gameplay quality improvement is claimed. Record real local measurements before comparing LM-02 and LM-03.
