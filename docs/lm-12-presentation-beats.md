# LM-12: Committed, actor-observable presentation beats

## Shared presentation contract

`packages/engine/src/presentation-beat.ts` builds versioned presentation from a **specific committed beat**, actor-authorized LM-02 scene text, narrow observable outcome sentences, actual receipt elapsed time and a local quote list. The **engine-only sidecar** contains beat ID plus world revision/event sequence. That basis is deliberately **not** in model text. The narrator never receives raw `WorldState`, mutation proposals, action inputs, hidden event payloads, RNG or tool catalog data.

Four entrypoints now use the same beat shape:
- Action: one player-facing scene snapshot plus authorized, filtered committed receipt results. A successful routine operation with **no canonical event** still produces an observable outcome. An actor/locality event must also pass player relevance in addition to `access: public`.
- Opening: compact actor perspective and the **already realized** creature/phenomenon/mundane scene material. One narration invocation; deterministic committed-material fallback remains.
- First-power Awakening: a persisted immutable `manifestationPresentationScene` with established power details and publicly observable evidence. Existing retry invokes **presentation only**, never regenerates a power or replays the threshold operation.
- Exceptional consequential conversation: LM-02 player perspective, authoritatively recorded speech semantics and committed action indicator; quotes must survive intact. LM-05 ordinary single-NPC dialogue is already presentation, composed deterministically without another prose call.

Each kind still dispatches the package's protected style with `deriveSceneRegister`: urgent positioning, measured normal play, and justified duration compression. The engine does **not** hardcode Awakening Earth's modern voice; the reference package still supplies it. Profile compilation now keeps the non-negotiable agency, knowledge, no-actionable-invention and reference-genre rules but does not repeatedly paste every long description/exemplar.

## Source truth and rendering behavior

`observableActionOutcomes` recognizes only specific validated public-facing result properties such as explicit result success and committed routine action description; arbitrary result fields are not given to a narrator. It selects public event summaries only when an actor or current authorized scene scope is related. Off-screen public events and GM-only content remain out. Engine receipts and time alone do **not** authorize claims of an unsimulated morning or a newly accessible clue.

`validatePresentedText` checks empty/overlong output, unchanged player quotes, obvious invented player choices and a narrow set of **new ungrounded actionable affordances**. A failed model validation never commits narrator-created objects. Semantic safety cannot be proven by regex; these are conservative, targeted guards in addition to source restriction and scripted tests.

A trivial committed `I sit/stand/wait/rest` routine task can render from its confirmed event-sparse receipt without a model call. Ordinary NPC replies preserve speaker names, wording, order and minimal safe manner. Other resolved actions use at most one model narration call on the normal path, and no extra critic call.

## Snapshot and failure safety

An `ActionRun` now has **optional**, versioned `narrationScene`. It is frozen and persisted **before** the first model invocation; metadata validation prohibits any later rewrite. A failed text generation or unsafe response leaves committed receipts/RNG/world time unchanged. Even if the world has advanced, the action's retry uses the original scene, original observable outcomes and original revision basis, then persists the validated prose once. Old runs without a snapshot can still load: they create their first snapshot on presentation. Already persisted narration remains immutable and reusable.

`OpeningProgressionState` similarly has optional `manifestationPresentationScene` for exact first-power retry/reopen source fidelity. Original saves without the field are loadable, and no model timeout can reroll the power. Openings retain deterministic fallback copy; routine actions can use a safe receipt-based fallback; other unrecoverably uncertain narration reports a **presentation-only retry** rather than guessing canon.

## Integration and performance follow-up

Automated tests cover exact quotes, off-screen private/public filtering, event-sparse deterministic fallback, NPC reply composition, style preservation, ungrounded exits and frozen action narration after intervening world time. The existing opening-mode and Awakening retry suites remain the compatibility gate.

The intentionally deferred cross-system pass should check: mixed/multiple NPC material replies with exact chronology and player quote fidelity; deeply adversarial narrator hallucinations with a real local model; source-aware first-power re-entry across complex save boundaries; actual call counts, token budgets, device latency, and long campaign quality. Scripted-model CI is not a real local-model benchmark.

The shared contract is deliberately about **rendering**. New canonical affordances belong to LM-10's authorized realization path, never retrospective promotion of invented prose.
