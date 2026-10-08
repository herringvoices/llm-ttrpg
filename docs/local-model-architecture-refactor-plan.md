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
- **Next batch:** LM-07, LM-08, LM-09. Flesh these out directly as GitHub issues.

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

## Suggested design order (not necessarily implementation order)

**First pass:** LM-01 → LM-02 → LM-03 → LM-04 → LM-05 → LM-06

**Second pass:** LM-07 → LM-08 → LM-11 → LM-12

**Third pass:** LM-09 → LM-10 → LM-13

Some work can run in parallel once shared contracts are agreed. Final implementation sequencing will be set when dependencies are refined.

## Cross-cutting questions to resolve during ticket discussions

- What constitutes a material state change, and which apparently mundane events are required for causal continuity?
- How much model-authored uncertainty is acceptable in interpreting a creative physical action?
- When should the engine ask the player for clarification rather than select a safe default?
- How do we preserve socially important statements without committing a new belief for every sentence?
- What model capability assumptions are legitimate at the default CPU tier?
- How can summaries remain perspective-correct and never silently overwrite canonical facts?
- Which existing persistent structures are worth keeping behind a compact projection, and which should truly be removed?
- How do we make the system improve with stronger optional models without branching game rules or save formats?

## Ticket specification template (use when we focus on one)

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

- **2026-10-08:** Initial proposed backlog created from repo audit. No tickets are fully specified or marked Ready for Dev.
- **2026-10-08:** Favor simplification of model-facing responsibilities, not elimination of determinism or package modularity.
- **2026-10-08:** Baseline measurement and compact context contracts precede hot-path rewrite.
- **2026-10-08:** Detailed specifications for LM-01 through LM-03 moved to GitHub issues #46–#48; the separate ticket Markdown file was retired. Future tickets should be authored directly as issues.
- **2026-10-08:** Specified LM-04 through LM-06 directly as GitHub issues #49–#51, preserving ruleset authority, NPC knowledge boundaries, and event-dependent opening progression as explicit constraints.

## Next discussion

Start with **LM-01 (measurement)** or **LM-02 (brief architecture)**. My suggested default is LM-01 first so subsequent changes can be measured rather than judged only by feel. During design, keep the end-state vision visible but resist turning every idea into an immediate implementation issue.
