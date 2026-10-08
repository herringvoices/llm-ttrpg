# Local-Model Architecture Refactor: Ticket Design Plan

**Status:** Planning / discovery. No implementation authorized by this document.
**Target:** Bundled local Qwen3.5 9B (CPU-first), while preserving swappable game packages and stronger model tiers.
**Source:** October 2026 repository audit and architectural discussion.
**Working principle:** **Rich engine. Small briefs. Few decisions. Sparse memory.**

## Purpose

The current gameplay architecture asks a relatively small local model to perform too many sequential jobs: interpret declarations, retrieve context, select tools, construct detailed mechanical inputs, reason about each NPC, extract persistent social consequences, narrate, and sometimes replan the campaign. Ordinary actions can generate too many model calls and durable records.

We will design a series of implementation tickets that reduce **model decision complexity, context volume, call count, and persistent-state growth** without sacrificing player agency, deterministic rules, perspectives/hidden knowledge, or persistence reliability.

**This document is a high-level planning index, not the implementation ticket source of truth.** Detailed specifications live in GitHub issues. Proposed ideas can become issues as they are fleshed out; creating an issue does not automatically mean it is Ready for Dev.

## Non-negotiable design constraints

- Simulation/rules own authoritative truth. Model outputs are proposals or presentation, never direct mutations.
- Player declarations, choices, quoted dialogue, and agency must not be silently rewritten.
- NPCs and narrators must not access knowledge outside their authorized perspectives.
- Fictional time, Action Pressure, checks, RNG, progression, and save/retry safety remain deterministic or authoritatively validated.
- Game rules, setting, and narration stay package-driven; the engine must not hard-code Awakening Earth.
- Keep lazy world simulation (catch up when attention returns) rather than continuous simulation.
- Preserve existing saves where feasible. Explicitly design versioning/migration and rollback before altering storage contracts.
- Do not make a larger model a prerequisite for acceptable play.

## Outcome measures (provisional, to confirm during ticket design)

- Routine turn: usually 0–2 model invocations; complex turn usually no more than 3, with documented exceptions.
- Ordinary conversation with one NPC: usually 1 model invocation.
- Model-facing scene briefs: initially target approximately 2–6k serialized characters, measured alongside actual token usage rather than treated as a universal hard cap.
- Zero durable world mutations is a valid outcome for ordinary turns.
- No full event log, full actor belief store, or large planner document sent to the model by default.
- Planner calls are unusual and event/boundary-triggered, not the default after a turn.
- Regression harness records per-turn call count, latency, token usage, persistent writes, context content/size, and task correctness.

**These are design targets, not claims that the current build meets them.** First establish baseline measurements and representative off-script scenarios.

## Ticket design workflow

Each ticket moves through:

1. **Proposed:** High-level outcome and motivation captured here.
2. **In discussion:** Resolve key policy questions, expected behavior, and ownership.
3. **Specified:** Write the full specification directly in a GitHub issue, including scope, non-goals, dependencies, contracts, migration/rollout, edge cases, test matrix, and acceptance criteria.
4. **Ready for Dev:** Set the GitHub Project status after the specification and dependencies are agreed.
5. **In progress / Verified:** Implement, instrument, run deterministic tests and local-model playtests, then update this plan.

Do not automatically label a GitHub issue Ready for Dev merely because it has been created. Avoid treating all tickets as independently executable; there are deliberate sequencing dependencies below.

## Active ticket issues

- **Batch 1 (specified):** [LM-01 — Turn diagnostics](https://github.com/herringvoices/llm-ttrpg/issues/46), [LM-02 — Compact model briefs](https://github.com/herringvoices/llm-ttrpg/issues/47), [LM-03 — Unified routing](https://github.com/herringvoices/llm-ttrpg/issues/48). GitHub issues are the authoritative, detailed ticket specifications; no separate ticket Markdown is maintained.
- **Batch 2 (specified):** [LM-04 — Engine-owned mechanical derivation](https://github.com/herringvoices/llm-ttrpg/issues/49), [LM-05 — Lightweight NPC conversations](https://github.com/herringvoices/llm-ttrpg/issues/50), [LM-06 — Durable state materiality](https://github.com/herringvoices/llm-ttrpg/issues/51). Specifications are in the issues, not separate Markdown files.
- **Batch 3 (specified):** [LM-07 — Bounded continuity memory](https://github.com/herringvoices/llm-ttrpg/issues/52), [LM-08 — Boundary-driven campaign planning](https://github.com/herringvoices/llm-ttrpg/issues/53), [LM-09 — Compact campaign seed](https://github.com/herringvoices/llm-ttrpg/issues/54). These are the authoritative specifications; no parallel Markdown ticket file.
- **Batch 4 (specified):** [LM-10 — Lazy realization](https://github.com/herringvoices/llm-ttrpg/issues/55), [LM-11 — Scene-driven Action Pressure](https://github.com/herringvoices/llm-ttrpg/issues/56), [LM-12 — Committed-outcome narration](https://github.com/herringvoices/llm-ttrpg/issues/57). Detailed specifications live in the GitHub issues.
- **Batch 5 (specified):** [LM-13 — Local-model quality gates, compatibility, and rollout](https://github.com/herringvoices/llm-ttrpg/issues/58). All thirteen LM tickets are now specified; implementation status remains separate from specification.
- **Integration review:** The [cross-ticket integration review](#cross-ticket-integration-review-2026-10-08) below records interface ownership, conflicts, dependencies and recommended implementation waves.

## Backlog overview (high-level only)

### LM-01 — Establish local-model gameplay baseline and regression harness
**Priority:** P0 · **Suggested first**
**Outcome:** Measure what is expensive and what fails in realistic gameplay, beyond schema correctness.

Capture model call graph, per-call inputs/outputs (with suitable redaction in diagnostic export), tokens, latency, context budget, invalid responses/retries, world mutations, event growth, and success/failure. Add repeatable scenarios for routine actions, exploration, movement, basic conversation, multi-NPC conversation, uncertain action, power use, time jump, and save/reopen.

**Decisions to flesh out:** Definition of a successful turn; instrumentation scope; benchmark fixtures; representative hardware/model configuration.

### LM-02 — Define model-facing compact briefs and context-selection policy
**Priority:** P0 · **Foundation for LM-03/04/05/06**
**Outcome:** Replace broad serialized context packages in ordinary model prompts with narrow, role-safe briefs.

Design `SceneBrief`, `ActorBrief`, and optional `ActionBrief` / `NarrationBrief` (exact shape TBD). Deterministic projections should include immediate scene, relevant character capabilities, a bounded continuity summary, and only necessary knowledge. Raw state, access metadata, IDs, catalog scaffolding, full history, and unrelated facts remain engine-only.

**Decisions to flesh out:** Brief schemas and per-task budgets; how relevance is scored without another model call; resolving local references; what to omit; how hidden information remains isolated.

### LM-03 — Simplify declaration routing and remove normal-play tool exploration
**Priority:** P0 · **Depends on LM-02**
**Outcome:** Route declarations to a small number of semantic handlers without LLM navigation of the hierarchical catalog.

Candidate families: movement, observation, conversation, routine action, uncertain action, power use, and wait/time passage. Keep the existing registry/catalog internally. Engine chooses available operations; ambiguous or compound declarations retain explicit handling.

**Decisions to flesh out:** How many routing calls are truly necessary; compound speech+action; unknown action fallback; Action Pressure changes; when clarification is required.

### LM-04 — Engine-owned mechanical check construction
**Priority:** P0 · **Depends on LM-03; may use LM-02**
**Outcome:** Stop asking the local model to assemble large `PerformancePlan` / `resolve-action` inputs.

The model should provide only semantic intent, approach, targets, and perhaps a tiny set of choices that cannot safely be derived. The rules package determines applicable attributes/skills, resistance, modifiers, effect bounds, consequences, duration, and check execution. Preserve mechanical inspectability.

**Decisions to flesh out:** Rule-based vs model-assisted attribute/skill selection; adversarial/creative actions; generic check fallback; balancing and player transparency.

### LM-05 — Lightweight NPC conversation path
**Priority:** P0 · **Depends on LM-02/03**
**Outcome:** Ordinary one-NPC conversation should usually be one model call producing player-facing NPC speech/observable behavior plus narrowly structured exceptional requests.

Avoid separate speech reinterpretation, private NPC cognition, durable extraction, and narration calls for every utterance. Preserve quotation fidelity, knowledge boundaries, player agency, and authoritative resolution of consequential NPC actions.

**Decisions to flesh out:** Multi-NPC turns; commitments/deception; proposed NPC actions; when to branch to deeper resolution; dialogue-to-memory boundary.

### LM-06 — Materiality threshold and tiered state retention
**Priority:** P0 · **Coordinate with LM-05 and LM-07**
**Outcome:** Stop canonizing every routine action, conversational remark, or newly mentioned incidental location.

Define **ephemeral scene detail**, **summary memory**, and **durable canonical change**. Ordinary completed tasks may need no historical event. Important changes still commit deterministically. Audit routine-task events, speech records, location creation, beliefs/memories and other writes.

**Decisions to flesh out:** Which events remain mandatory for causality/replay; no-retcon guarantees; persistence migrations; local places becoming important; what is summarized versus removed from model-visible memory.

### LM-07 — Bounded, event-triggered memory and summarization
**Priority:** P1 · **Depends on LM-06; supports LM-02**
**Outcome:** Provide concise scene, relationship, and campaign continuity without retrieving all historical records.

Use deterministic aggregation where possible; invoke the model for summarization only at appropriate boundaries, with conservative source grounding and versioned summaries. Keep authoritative raw history accessible for audit rather than ordinary prompts.

**Decisions to flesh out:** Summary refresh triggers; stale summary detection; compression hierarchy; conflicting testimony vs truth; recovery of details on explicit request.

### LM-08 — Simplify campaign direction and remove per-turn replanning
**Priority:** P1 · **Depends on LM-02/07**
**Outcome:** Replace the current model-facing three-horizon planning document with a short campaign-direction brief and update it only at meaningful boundaries.

Retain grounded active pressures, major threads, player interests, and near-term opportunities. Use deterministic validation to trigger exceptional reconsideration. Avoid low→medium→high replanning loops during routine play.

**Decisions to flesh out:** Whether to simplify stored planner schema or only its model projection; event triggers; optional protected planner; migration of old plans.

### LM-09 — Lean starting campaign generation
**Priority:** P1 · **Depends conceptually on LM-02/07/08**
**Outcome:** Replace the many-stage starting-region generation workflow with a compact seed generation flow.

Proposed broad stages: normalize user input; generate compact region/NPC/pressure seed; generate opening brief. Derive IDs, defaults, rules boilerplate, and validated records in code. Preserve the recent opening/first-power decisions without requiring exhaustive pre-generation.

**Decisions to flesh out:** Exact stage count and schemas; required world elements at launch; fallback behavior; existing campaign compatibility; how/when to expand details.

### LM-10 — Lazy realization of people, places, and mechanics
**Priority:** P1 · **Depends on LM-06/09**
**Outcome:** Generate or complete granular entities and mechanics only when they become relevant to player decisions or consequential simulation.

Avoid prebuilding every NPC relationship, detailed location, monster capability, or process. Preserve established constraints, deterministic mechanical defaults, and no-retcon rules.

**Decisions to flesh out:** Trigger thresholds; when a mentioned place becomes canonical; entity identity and deduplication; latency at realization; safe generic placeholders.

### LM-11 — Simplify Action Pressure assessment and turn lifecycle
**Priority:** P1 · **Coordinates with LM-03/04**
**Outcome:** Preserve the 1–9 Action Pressure mechanic while reducing repeated model estimates of level/duration and unnecessary execution-decision loops.

Use scene pressure, active threats, material circumstances, and deterministic duration defaults. Reassess when the situation actually changes. An action stops when its bounded outcome is committed or a meaningful new player decision is needed, rather than requiring repetitive model stop decisions.

**Decisions to flesh out:** Pressure transitions; broad low-pressure activities; mixed/compound declarations; durations; interruption boundaries.

### LM-12 — Consolidate narration inputs and remove redundant prose passes
**Priority:** P1 · **Depends on LM-02/04/05**
**Outcome:** Generate final prose from compact, actor-safe, already-resolved outcomes. Do not force a second narration generation when an NPC response is already suitable for display.

Keep package-specific narrative profile, immediate-scene consistency, agency boundaries, concrete affordance rules, and safe post-commit narration retry.

**Decisions to flesh out:** Shared presentation input; safe color versus actionable facts; verbosity; how conversation output and action output differ.

### LM-13 — Local-model quality gates, compatibility, and rollout
**Priority:** P1 · **Spans all previous tickets; final verification**
**Outcome:** Establish end-to-end playable quality on the bundled CPU model and confirm that refactors preserve existing games/saves where promised.

Create scenario acceptance tests with realistic model runs alongside deterministic fixtures. Measure cost/performance and visible failures. Plan feature flags or staged migration so individual refactors can be tested and rolled back.

**Decisions to flesh out:** Minimum performance baseline; hardware test matrix; acceptable failure rates; backward compatibility; what constitutes release readiness.

## Cross-ticket integration review (2026-10-08)

**Status:** Specification-level architectural review, not evidence of implementation or a verified release. All 13 issues have detailed specifications. This section resolves ownership and work order across them without replacing their acceptance criteria. The GitHub issues are the implementation source of truth.

### Ownership and handoff matrix

| Boundary | Responsible issue | Other issues consume, not reimplement |
| --- | --- | --- |
| Invocation/turn measurements, baseline and diagnostic correlation | [LM-01](https://github.com/herringvoices/llm-ttrpg/issues/46) | Every refactor measures through the same observer; no new gameplay model calls for instrumentation |
| Authorization, local reference mapping, compact scene/actor/route briefs | [LM-02](https://github.com/herringvoices/llm-ttrpg/issues/47) | LM-03/05/07/08/12 request a view with purpose and perspective; do not create parallel “mini context engines” |
| Single interpretation, ordered declaration segments, semantic modes, registry-based operation selection | [LM-03](https://github.com/herringvoices/llm-ttrpg/issues/48) | LM-04 gets validated attempts; LM-05 gets verbatim communication; LM-11 owns duration/stop |
| Numeric/mechanical check derivation, resistances, effects, rules package policy | [LM-04](https://github.com/herringvoices/llm-ttrpg/issues/49) | LM-10 ensures required mechanically realized state exists before LM-04 evaluates a check |
| NPC speech generation and consequential-NPC escalation | [LM-05](https://github.com/herringvoices/llm-ttrpg/issues/50) | LM-06 decides whether proposed social outcomes persist; LM-12 displays speech rather than regenerating it |
| Durable world materiality, event-vs-receipt evidence and opening-power source compatibility | [LM-06](https://github.com/herringvoices/llm-ttrpg/issues/51) | LM-07 source summaries, LM-08 event/boundary triggers, LM-12 narration and first-power progression all consume typed sources |
| Source-aware, perspective-safe continuity caches, refresh triggers and historical recall | [LM-07](https://github.com/herringvoices/llm-ttrpg/issues/52) | LM-02 projects cached continuity; LM-08 uses compact continuity, never authorizes new canon |
| Planner trigger decisions, compact campaign direction, plan revision/grounding validation | [LM-08](https://github.com/herringvoices/llm-ttrpg/issues/53) | LM-09 creates a valid seed-derived initial plan without requiring the full planner refactor first |
| Compact initial creative seed and deterministic campaign-scaffolding expansion | [LM-09](https://github.com/herringvoices/llm-ttrpg/issues/54) | LM-10 enriches this state only when required; do not prefill all possible people/places |
| Targeted missing entity/identity/place/mechanics realization and deduplication | [LM-10](https://github.com/herringvoices/llm-ttrpg/issues/55) | LM-04 uses realized mechanics; LM-12 cannot use its prose to create them |
| Scene-scoped pressure triggers, authorized horizon, elapsed-time accounting, interruption and authoritative stop | [LM-11](https://github.com/herringvoices/llm-ttrpg/issues/56) | LM-03 never declares goal completion solely from action-mode coverage; LM-05/12 consume pressure rather than reassessing it |
| Player-observable committed-beat projection, narration profile compilation, and presentation-only retry | [LM-12](https://github.com/herringvoices/llm-ttrpg/issues/57) | LM-05 ordinary NPC reply remains display-ready; LM-06 event-sparse receipts remain narratable |
| Integration tests, real local-model rubric, performance evidence, save migrations, staged rollout | [LM-13](https://github.com/herringvoices/llm-ttrpg/issues/58) | Acceptance criteria are contributed incrementally by all tickets; LM-13 does not substitute for completing their own tests |

### Significant integration risks and agreed decisions

1. **LM-03 vs LM-11, competing action completion:** LM-03 owns *interpretation and execution selection* and must preserve ordered segments. **LM-11 owns the final stop/interruption and time accounting policy** based on receipts, postconditions and scene pressure. Early LM-03 improvements may have a temporary stop heuristic, but it must not grow into a second permanent completion engine. One semantic mode being handled does not prove the player's entire intent was completed.
2. **LM-04 vs LM-10, the missing-mechanics cycle:** The rules package cannot derive an opposed check without required target capabilities; lazy realization must not wait until after that check. Agree now on a small `ready | missing-required-data` preflight result from the ruleset adapter, with explicit fields/target, followed by one bounded authorized LM-10 realization before LM-04 retries derivation. For the first implementation, LM-04 can operate against already-realized fixtures; LM-10 adds the missing-data path later. Avoid a circular import or automatic endless realization chain.
3. **LM-05 vs LM-06 vs LM-07, speech and memory:** A line of NPC dialogue is **presentation**, a material pledge/disclosure/trade is a guarded **canonical consequence**, and a summary of the conversation is a **derived memory**. The fast ordinary speech path should not create a canonical belief or event on every line. LM-06 defines the materiality threshold and typed source/evidence identity; LM-07 summarizes only authorized source material. No three competing “is this important?” model classifiers.
4. **LM-06 vs opening power, sparse events:** Current opening power logic expects an event ID from the triggering meaningful turn. **Migrate to a versioned committed receipt-or-event evidence reference before suppressing low-value routine events**. A turn can be meaningful with zero new canonical events; first power still must manifest within 1–3 meaningful turns and remain retry-safe. Legacy event IDs must remain readable.
5. **LM-02/07/08/12, privacy:** A privileged planner can access more than a narrator, and an NPC can know more or less than the player. Build model-facing briefs from explicit perspective and purpose. Derived summaries inherit their **source access rights**, not “GM-readable therefore safe for every model.” The narration projector additionally checks *perceivability*; an event marked public may still describe an offscreen occurrence.
6. **LM-06/08, what triggers planning:** The planner must not depend on the existence of a generic event for every successful turn. Typed material world changes, explicit scene/time boundaries and committed receipt signals are its input. For ordinary event-sparse turns there is no history load, invalidation pass, model call or revision churn. Existing plans/assumptions remain readable.
7. **LM-09 vs LM-07/08, startup dependency is not strict:** Campaign startup runs before the main world/context exists. The compact initial proposal should use **source-preserving player/setup prompts** inspired by LM-02, not assume `SceneBrief` or continuity caches already exist. LM-09 should create a valid minimal initial `CampaignPlanDocument` directly and can be developed **in parallel** with LM-07/08 once seed/plan contracts are agreed. Otherwise we build an unnecessary long critical path. `2–3` is for core creative seed calls, not a hidden claim that optional creature, narration and repair calls vanished.
8. **LM-09 vs LM-10, minimal starter state:** Define stable IDs and enough locality/actor/mechanical/setting records to compile an actually playable world. Do not assume a deferred entity exists as canonical. LM-10's realizers fill only missing data at active attention, and share no-retcon/identity rules. An old fully generated campaign stays valid without being retroactively downgraded to “lazy”.
9. **LM-10 vs LM-12, imagined affordances:** A noun in narrator color (exit, firearm, route, witness, clue, magic item) is not a license to commit gameplay state. **Realize actionable detail before presenting it**, or omit it from generated prose. LM-12 can add genuinely non-actionable atmosphere only; it does not become a surrogate world generator.
10. **LM-11 vs LM-05/12, one scene clock:** Conversations use the same pressure basis as physical actions, and narration describes **actually committed** elapsed time. Preserve existing nine-level caps unchanged: 8h, 2h, 30m, 10m, 2m, 60s, 30s, 10s, 5s. No second speech-only time clock and no LLM-authored pressure downgrade to complete an overlong attempt.
11. **LM-12 vs LM-06, event-sparse presentation:** Action receipts and player-observable state deltas, not public event count, decide what the narrator can truthfully say. A successful routine action might produce zero events and still merit narration. The presentation retry must be anchored to the original committed beat, not whatever scene exists after later player actions.
12. **LM-13, measurement scope and rollback:** Count **all** calls in a full submitted turn and separately count core generation calls vs opening narration/repair/conditional creature calls. Temporary flags only at major seams; a flag flip cannot restore old code's ability to read newly written persisted schema. Use dual readers/versioned migrations and stage writes in dependency order.

### Recommended implementation waves

This is an execution order based on dependencies, **not** an instruction to implement automatically or mark everything Ready for Dev.

| Wave | Implement | Gate before moving on |
| --- | --- | --- |
| **A · Protect & measure** | LM-01, LM-02 | Instrumented scripted baseline; authorized compact briefs and local refs |
| **B · Simplify the hot path** | LM-03, then LM-04 and LM-05 in parallel | Ordered actions and dialogue work; mechanics still authoritative; no duplicate interpretation |
| **C · Repair evidence/persistence** | LM-06 first migrate event-dependent consumers, **then** suppress low-value events | Zero-event meaningful turn and first-power 1–3-turn compatibility; old save and retries |
| **D · Remove repeat work** | LM-07, LM-08, LM-11, LM-12 using their owners' interfaces (parallel where code changes do not conflict) | Bounded context/summary, sparse planner, deterministic stop, no second NPC prose pass |
| **E · Lean startup and lazy detail** | LM-09 may begin alongside C/D; complete LM-09 → LM-10 | New compact and legacy campaign paths work; stable on-demand entities/mechanics |
| **F · Final release evidence** | LM-13 verification and rollout (start CI fixtures during A/B) | Real bundled CPU model and deterministic quality gates, migrations, rollback plan |

**Merge strategy:** Prefer small vertically playable increments through existing public engine contracts rather than merging four simultaneous incompatible rewrites of `runtime.ts` or `play-session.ts`. In each wave: schema/interface first; one playable scenario through actual desktop; then edge cases and broader tests. Feature flags are temporary migration aids, not permanent alternate engines.

### Remaining decisions to validate with measured runs

- **Performance targets are provisional.** LM-01 must measure the baseline and LM-13 must verify real local-model improvements. Do not invent latency/token success percentages. Routine 0–2 total calls is a target, while ordinary dialogue's one NPC-response call is *after routing* and may still mean two total calls.
- **Model limitations are empirical.** Three compressed seed stages may be more reliable than one overloaded schema; test validity, output length, retry rate and player experience before freezing LM-09's stage count.
- **Quality is not only call count.** The no-retcon, no-double-commit, player-agency and private-information gates are strict; prose quality needs recorded human examples and failure cases.
- **No extra issue needed yet.** The shared seams belong to existing tickets. If implementation reveals a truly missing standalone capability, create a focused follow-up rather than extending the orchestrator indefinitely.

## Cross-cutting questions to resolve during ticket discussions

- What constitutes a material state change, and which apparently mundane events are required for causal continuity?
- How much model-authored uncertainty is acceptable in interpreting a creative physical action?
- When should the engine ask the player for clarification rather than select a safe default?
- How do we preserve socially important statements without committing a new belief for every sentence?
- What model capability assumptions are legitimate at the default CPU tier?
- How can summaries remain perspective-correct and never silently overwrite canonical facts?
- Which existing persistent structures are worth keeping behind a compact projection, and which should truly be removed?
- How do we make the system improve with stronger optional models without branching game rules or save formats?

## Historical ticket specification template (all current tickets already specified)

### LM-XX — Title
- **Status:** Proposed / In discussion / Specified / Ready for Dev / In progress / Verified
- **Problem / observed failure:**
- **Desired player-visible behavior:**
- **Scope:**
- **Explicit non-goals:**
- **Architecture / contracts touched:**
- **Design decisions:**
- **State and migration implications:**
- **Dependencies:**
- **Failure handling / rollback:**
- **Deterministic tests:**
- **Bundled-model playtests / performance budget:**
- **Acceptance criteria:**
- **GitHub issue:** TBD

## Decision log

- **2026-10-08:** Completed LM-13 issue #58 and cross-reviewed all 13 specifications; clarified authority for routing/completion, mechanics/realization, speech/materiality/memory, event-sparse opening evidence, and scene pressure/presentation. No gameplay implementation was done.
- **2026-10-08:** Initial proposed backlog created from repo audit. No tickets are fully specified or marked Ready for Dev.
- **2026-10-08:** Specified LM-10 through LM-12 directly as GitHub issues #55–#57, grounding lazy realization in existing no-retcon rules, keeping 1–9 pressure horizons unchanged, and preventing narration from inventing playable world state.
- **2026-10-08:** Favor simplification of model-facing responsibilities, not elimination of determinism or package modularity.
- **2026-10-08:** Baseline measurement and compact context contracts precede hot-path rewrite.
- **2026-10-08:** Detailed specifications for LM-01 through LM-03 moved to GitHub issues #46–#48; the separate ticket Markdown file was retired. Future tickets should be authored directly as issues.
- **2026-10-08:** Specified LM-04 through LM-06 directly as GitHub issues #49–#51, preserving ruleset authority, NPC knowledge boundaries, and event-dependent opening progression as explicit constraints.
- **2026-10-08:** Specified LM-07 through LM-09 directly as GitHub issues #52–#54, distinguishing derived perspective-safe memory, sparse foreground planner triggers, and versioned compact campaign generation.

## Next execution planning step

Before moving any ticket to **Ready for Dev**, check the interface ownership matrix and confirm the contract/tests for its dependencies. Begin with **LM-01** (measurement) and **LM-02** (compact perspective-safe context), then proceed in the waves above. The 13 issues are specified but their code changes and real-model performance claims have not been implemented or verified by this planning exercise.
