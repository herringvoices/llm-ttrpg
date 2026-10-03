# Player Action Execution Pipeline

Issue #11 connects freeform player declarations to the existing pressure, context, catalog, operation, resolution, persistence, and model-runtime contracts. The orchestration is game-agnostic: it uses the active `GameDefinition` and contains no reference-game mechanics.

## Run lifecycle

A new caller-supplied action ID receives one structured interpretation. The engine resolves context-local targets, injects the caller's actor, persists the accepted pressure assessment, bounds the existing intent, and creates a versioned `ActionRun`. A clarification result creates no run and changes no authoritative state.

Execution never stores or runs a future operation list. Each model turn chooses one catalog discovery, inspection, read-only query, authoritative operation, or stop. Context is rebuilt after each committed operation. The original goal and authorized horizon remain fixed; exact committed durations accumulate in `elapsedMs`, and reaching the horizon deterministically stops the run.

## Authority and transactions

`ActionRun` and its receipts are persistent orchestration records, not fictional truth. They are excluded from checkpoints. Each authoritative operation uses one transaction boundary containing its validated mutations, exact time advancement, events, committed RNG progression, and appended receipt. Rejected proposals discard their candidate state and tentative randomness. A later failure never rolls back earlier receipts.

Resolution intent is always constructed from the run by the engine. The model supplies only operation arguments. Context-local references are replaced exactly before authoritative schema validation; unknown `scene.*` references are rejected rather than guessed.

Stable action and step identities make retries resumable. Reusing an action ID with another actor or declaration is an identity conflict. A stopped run never executes again, and an active run whose world revision changed externally stops rather than continuing under stale authorization.

## Context and narration

Catalog metadata and validated query results are temporary context items. Query results carry the source world revision and are automatically discarded after a commit; catalog documentation is not revision-bound. No discovery history grants authorization—the same contextual policy is checked during listing, inspection, and binding resolution.

Narration occurs only after execution stops. It uses a fresh actor-role context, committed public consequences, exact elapsed time, and the final stop reason. Opaque rules results are retained in private receipts rather than assumed actor-safe. Rejections, tentative RNG, uncommitted mutations, and GM-only context are excluded. Narration failure cannot undo committed reality, and a later retry can finish prose without replaying mechanics.

The returned diagnostic trace is non-canonical and records context/model phases, accepted intent and pressure, discovery/query results, rejections, complete committed receipts, remaining authorization, stop, and narration outcome. A stopped run also returns a lightweight non-authoritative signal for future #28 integration; the pipeline does not invoke a planner.
