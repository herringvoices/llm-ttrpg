# Lazy World Simulation and Catch-Up

Issue #12 implements a sleeping-system model. Fictional time may advance while most of the world does no work. When a simulation boundary becomes relevant, the engine explicitly catches up only that scope and the prerequisite scopes on which it depends.

## Simulation scopes

A simulation scope is a stable, game-authored boundary with a generic kind, optional parent, and optional explicit scope dependencies. It is not automatically an entity or a container for every entity below it. Game packages decide which regions, institutions, sites, or other systems genuinely require independent simulation; the engine does not assign setting meanings to scope kinds.

The loaded registry validates unique IDs, missing parents/dependencies, and cycles. It exposes lookup, child/ancestor traversal, and deterministic dependency closure. Waking a target includes its parent/dependency closure but never its descendants, siblings, or unrelated scopes.

Every registered scope receives an authoritative `SimulationCursor` at campaign initialization. The cursor records the last fictional instant to which that scope was resolved. Advancing world time never advances these cursors by itself.

## Package-owned world processes

Rulesets, settings, adapters, and campaigns may contribute world-process definitions through their existing versioned component boundary. A process declares:

- stable ID, semantic version, description, and deterministic/stochastic kind
- supported generic scope kinds
- process dependencies
- narrow event interests
- scheduled-trigger types it handles, when deterministic
- a read-only state selector and a validated proposal-producing catch-up function

The state selector receives the same explicit deep-frozen rules-visible world projection used by operations and returns only JSON-compatible process input. The process receives that selected state, the complete elapsed interval, relevant events, assigned due work, remaining computation budget, and—only for stochastic processes—engine RNG. It has no persistence adapter or direct mutation capability.

Process outputs use existing mutation and event proposals plus explicit scheduled-work processing, cancellation, replacement, diagnostics, and work-unit accounting. The engine validates all output before it can become authoritative.

## Ordering and relevance

Process dependencies form a validated DAG. Execution order is deterministic; ready deterministic processes precede stochastic processes. A later process selects state only after earlier proposals have been applied to the transaction's working snapshot, so outcomes are never merged from stale parallel snapshots.

Event interests compile to bounded existing history queries. The engine enforces the interval `cursor < occurredAt <= target`, pages deterministically, deduplicates results, and also makes matching provisional events from earlier processes visible to later processes. Complete world history is never supplied by default, and no LLM relevance judgment participates.

Due scheduled triggers in the scope interval must have exactly one deterministic handler for that scope kind. That handler must explicitly process every assigned trigger exactly once. It may cancel/replace work or schedule validated future work. Scheduled possibilities remain non-events until a process resolves a meaningful consequence.

## Catch-up transaction

`session.catchUpScope({ scopeId, targetTime?, maxWorkUnits? })` defaults to current fictional world time and never advances that clock. It:

1. validates the target cursor and resolves the smallest dependency closure;
2. skips scopes already current;
3. queries relevant history and due work per stale scope;
4. executes matching processes sequentially against a fresh working snapshot;
5. tentatively applies mutations, events, schedules, and lazy RNG streams;
6. advances each awakened cursor only in the working snapshot; and
7. commits the whole dependency closure as one existing revision-guarded world transaction.

If any selector, process, proposal, work-budget check, event validation, or persistence write fails, no state, event, schedule, RNG stream, or cursor is committed. Opaque ID allocation may have gaps, but no allocated candidate becomes authoritative.

A target whose cursor already equals the requested timestamp returns a structured `already-current` no-op without querying, executing, allocating RNG, or committing a revision. A cursor later than the target is invalid.

## Granularity and safeguards

The engine passes one complete elapsed interval. It has no minute/hour/day/week tick rule. Each process chooses a setting-appropriate detailed or aggregate algorithm and reports computation work units. A configurable catch-up work budget fails atomically when exceeded; the engine neither approximates the result nor asks an LLM to fill the gap.

Stochastic processes use the existing versioned local-stream RNG. Each process that actually draws consumes one tentative stream, which advances only with the final catch-up commit. Identical state, history, cursor, process definitions, and RNG progression reproduce the same process result and randomness trace.

## Diagnostics and boundaries

The result reports the requested scope and target, original/final cursor, awakened scope order, process order, relevant events, scheduled work, proposed/canonical outcomes, RNG traces, work usage, and world revisions. These diagnostics are non-canonical and intended for the future #16 harness.

This issue provides an explicit engine API only. Entering a location, retrieving simulation-dependent context, NPC activity, campaign planning, and other future relevance policies may call it later, but automatic hooks are not scattered through unrelated systems. Catch-up is deterministic/structured infrastructure; it does not ask an LLM to invent elapsed history or narrate it.
