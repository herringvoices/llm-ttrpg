# LM-04 — Trusted action mechanics preparation

Ticket: [LM-04](https://github.com/herringvoices/llm-ttrpg/issues/49) · 2026-10-08.

## Boundary and authority

The engine owns the `SemanticActionAttempt` contract, optional ruleset `prepareActionAttempt` registration, strict registration validation, and `validatePreparedActionAttempt`. The adapter receives a read-only **authoritative world view** and the already-validated LM-03 attempt. It returns `ready` (registered operation ID, complete operation input, private derivation record), `missing-required-data` (which records need realization, for LM-10), `cannot-attempt` (grounded reason), or `not-applicable` (specialized handler keeps its own schema).

The engine checks that a prepared operation matches the actually selected and authorized registry operation, validates its full input against that operation's schema, and executes it through existing assess/resolve and transactional receipt pathways. It does not pass the preparer's canonical IDs, numeric plan, or private derivation to the model. A model-produced plan cannot override package-prepared numeric mechanics. Desktop's LM-03 `registeredOnly` path activates preparation; legacy direct `performPlayerAction` callers are unchanged. No save schema migration is needed.

## Reference-rules generic resolver policy

Implemented in `packages/reference-game/src/ruleset/attempt-preparer.ts`. For `rules.actions.resolve-action` only:

| LM-03 semantic mode | Existing attribute selection |
| --- | --- |
| Attack | Agility and Strength |
| Movement | Agility and Endurance |
| Manipulation | Strength and Fine Motor Skills |
| Observation | Perception and Focus |
| Communication | Presence and Social Fluency |
| Recovery | Endurance and Focus |
| Interaction / Other | Improvisation and Focus |

The first applicable mode in the above precedence is chosen. The actor's **already recorded skills** are eligible when their name matches the stated action/means; the general Fighting skill is also eligible on explicit attack modes. This does not create new skills or grant experience for unmatched skills. Existing character statuses/stress are incorporated by `calculatePerformance`, not double-counted as hand-authored modifiers.

Default package fixed Resistance benchmark: **55** (ordinary unknown difficulty). An explicit, finite, nonnegative `rules.action-resistance` fact on the target overrides the default, with its authored fact ID recorded in provenance. A living opponent in an attack uses **opposed** performance from its realized Agility and Perception instead; if opponent mechanics are missing, return `missing-required-data`, not fictional stats. A nonliving object is not treated as a mechanical opponent.

Generic attempted Effect magnitude: **1**; physical attack potential Effect **2**. Fatal consequences and PC death consent are never inferred. Injury for opposed physical attacks remains nonfatal and subject to the original status/protection safeguards. No helpers, combined contributions, invented equipment bonuses, or arbitrary situational modifiers are supplied. Material time for one generic attempt is at most **1,000 ms**, further bounded by the engine's remaining Action Pressure horizon. These numbers are explicit reference-rules policy knobs, not claims about perfect challenge calibration.

A named implement such as a crowbar or torch requires an actual established holding in the current actor data. A claimed item without evidence returns `cannot-attempt`; one is not conjured to suit the prose. A generic action **does not activate powers**: power use must pass a specialized registered handler enforcing existing power functions, reach and mana cost. Failure or unrealized mechanics does not authorize a model to guess a difficulty or an effect. Once an inventory and realization policy is formalized (LM-10), these results can be handled more gracefully without weakening this boundary.

A successful generic outcome means the rules resolved an **attempt** and recorded only that resolution's normal consequences. It does not, by itself, assert a persistent new object, burning warehouse, opened door, discovered NPC secret, or invented environmental effect. Material world persistence remains LM-06's responsibility.

## Test and measurement protocol

- `packages/reference-game/test/attempt-preparer.test.ts`: deterministic plan, authored numerical provenance, opposed target, missing mechanics, absent implement/power, creative attempt, pressure duration, and specialized operation delegation.
- `tests/player-action-pipeline.test.ts`: `registeredOnly` generic action should commit one receipt with **zero** `player-action.tool-arguments.v1` model invocations; replay should not repeat RNG or the commit.
- Existing `tests/resolution-rng.test.ts`, `tests/action-pressure.test.ts`, operation stress/PC safety, game-boundary, and old-save tests remain regression coverage.

**Scripted comparison:** The legacy generic-resolution path asks `player-action.tool-arguments.v1` for a full mechanical input. The new registered-only generic path should ask **zero** mechanical-arguments questions: a reduction of **one model invocation per selected generic check** in the illustrated fixture. LM-03's semantic classifier, any candidate choice among truly multiple registrations, remaining LM-11 stop decision, and narration calls can still happen. This is an architectural/scripted call-count comparison, not yet a measured provider runtime benchmark.

**Bundled local-model token count, wall-clock impact, quality and invalid-output rates have not been measured.** See `docs/lm-01-baseline.md` for manual measurement. No provider benefit is claimed from fixture call counts alone.

## Remaining follow-up boundaries

LM-10: targeted creation of not-yet-realized creature/player mechanics when preflight returns missing data. LM-06: which successful events cause durable environmental state changes. LM-11: authoritative goal-completion, stop and multi-operation scheduling. Specialized traversal, routine, power and conversation operations retain their own rules and may still require model-safe semantic inputs until their adapters are implemented separately.
