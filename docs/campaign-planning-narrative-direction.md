# Campaign Planning & Narrative Direction

**Status:** Settled and implementation-ready by Issue #28 — Campaign Planning & Narrative Direction

## Goal

The campaign planner supplies long-term coherence, pacing, thematic attention, callbacks, and story-minded judgment without becoming a source of fictional truth.

> **Simulation decides what is true. The planner decides what deserves attention.**

The planner may maintain possibilities, priorities, hypotheses, provisional detail, and several plausible future directions. It may not establish events, override simulation, force player choices, directly control NPC/world actions, or rewrite canon to preserve a preferred arc.

## Persistence boundary

The living plan is persistent runtime/save state, but it is separate from:

- `WorldState`;
- canonical event history;
- actor/group beliefs;
- immutable campaign source content.

Persist a separate versioned planner document with its own monotonic `planRevision`, plus the `basedOnWorldRevision` and `basedOnEventSequence` used to prepare it.

Changing the plan must not increment world revision or append a canonical event merely because the GM changed direction.

Planner commits use optimistic concurrency. If authoritative state materially advances after a proposal is prepared, reject the stale proposal rather than applying it blindly.

Checkpoint/save creation snapshots the corresponding planner state. Loading or branching from an older checkpoint restores that branch's older plan so later GM knowledge/direction cannot leak backward.

Use a dedicated planner persistence port/store rather than embedding planner JSON inside `WorldState`.

## Three linked horizons

Store one versioned plan document containing three separately revisable horizons.

### High

Long-running themes, central tensions, durable conflicts, faction/world agendas, major mysteries, broad campaign phases, and several possible future end states.

High-level direction should be story-minded without prescribing a finale.

### Medium

Current arc/adventure-scale material: developing situations, important NPC/faction developments, meaningful consequences, discoverable revelations, escalating or cooling pressures, and likely-relevant locations over coming days/sessions.

### Low

Near-term attention: grounded hooks, accessible clues/opportunities, callbacks, immediate consequences, and thread intersections that might naturally surface over the next few scenes.

Low-level planning does not script the next scene.

## Narrative threads

A thread is a durable planning record for something that may continue to matter, such as:

- an unresolved relationship;
- a mystery;
- an institution/faction pressure;
- a player-created goal;
- a consequence that deserves a callback;
- a social/economic problem;
- a supernatural situation.

A thread should record:

- stable ID;
- title/summary/kind;
- owning horizon;
- priority/salience;
- status: `active | dormant | retired`;
- canonical/source grounding and provenance;
- related entities/events/goals/relationships/locations/situation candidates;
- player-interest references where applicable;
- current tension/question;
- assumptions;
- conditional possible developments;
- last-reviewed revision/rationale.

Threads may promote or demote between horizons.

Do not make `resolved` a planner-owned truth. If canonical state resolves the underlying issue, the planner may retire the thread because of those authoritative records.

## Assumptions

Planner assumptions must be explicit rather than hidden inside freeform prose.

An assumption records:

- stable ID;
- owning thread/horizon;
- summary;
- provenance;
- validation kind;
- status: `valid | invalid | unknown`;
- last evaluated authoritative basis.

Where possible, represent assumptions as references/paths plus expected values or predicates against authoritative records.

Example: an NPC still holds a particular job or relationship.

Deterministic code should detect when a machine-checkable assumption stops matching the world.

Some softer assumptions, such as whether the player still appears interested in a mystery, require heuristic/model review. They must still cite the evidence used.

Invalid assumptions create targeted replanning signals. They never cause canon to be rewritten to preserve the plan.

## Conditional developments

Possible developments are non-authoritative GM ideas.

Example: if an NPC's situation continues to deteriorate, they may seek a new job.

Such developments are:

- conditional;
- grounded;
- revisable/discardable;
- not scheduled events solely because the plan contains them.

If a new persistent detail is later needed, #26 commitment rules apply.

If an NPC/world system actually acts, normal actor/simulation machinery owns the action.

## Relationship to #26

Keep the division explicit:

> **#28 chooses what deserves attention.  
> #26 decides what can legitimately be generated or surfaced.  
> Actor/world/rules systems decide what actually happens.**

The planner may organize situation candidates, discovery affordances, provisional details, and conditional developments, but cannot bypass their authority boundaries.

## Player goals and interest signals

Distinguish explicit player goals from inferred interest.

### Explicit goals

Player-authored ongoing goals are strong planning inputs and may directly seed or raise the priority of threads.

They influence attention without guaranteeing an outcome.

### Inferred interest

Infer slower-moving interests from accumulated meaningful behavior such as:

- repeated voluntary engagement;
- follow-up investigation/questions;
- revisiting a person/place;
- spending meaningful time/resources;
- repeatedly choosing one thread over alternatives;
- repeated avoidance.

Do not treat every action as a preference signal.

An inferred signal should record its subject/thread, direction, strength/confidence, supporting action/event IDs, and review/decay metadata.

Repeatedly ignored optional threads may lose priority or become dormant. Underlying canonical pressures continue independently.

## Planning signals

Use lightweight non-authoritative planning signals that reference the canonical developments justifying review.

Possible sources:

- player action development signals;
- conversation/social changes;
- significant canonical events;
- NPC/faction/relationship changes;
- discoveries/revelations;
- resolved/invalidated situations;
- locality/arc transitions;
- large fictional-time jumps;
- lazy-simulation consequences;
- invalidated assumptions;
- exhausted horizon material;
- explicit player goals;
- accumulated interest changes;
- consistency reviews.

Signals are orchestration metadata, not fictional events.

Batch related signals from the same committed development before invoking the planner.

## Replanning and escalation

Always begin at the lowest affected horizon.

A low-level planner pass may request escalation to medium, but may not rewrite medium directly.

A separate medium pass may then revise medium and, if truly necessary, request high escalation.

A separate high pass occurs only when campaign-level direction is genuinely invalidated.

Do not invoke the planner after trivial actions or separately for every consequence of one action batch.

Use deterministic batching/debounce:

- immediate review for explicit invalid assumptions, exhausted plan, or clearly high-salience changes;
- otherwise accumulate signals until the current action/interaction/catch-up batch ends;
- avoid duplicate review at the same authoritative basis.

Do not use wall-clock background timers.

## Planner model contract

Planner calls use structured output.

A targeted request receives:

- requested horizon;
- current horizon state;
- relevant adjacent-horizon summaries;
- planning signals;
- bounded authoritative context/history;
- NPC/faction goals/relationships/status;
- relevant situations/provisional material;
- player goals/interests;
- campaign/storytelling guidance;
- assumption validation results.

Output a **plan mutation proposal**, not a freeform rewrite.

Supported mutation concepts should include:

- add/update thread;
- change priority;
- promote/demote thread;
- mark dormant/retired;
- add/update/remove assumption;
- add/update/remove conditional development;
- revise attention/provisional references;
- request escalation.

Before commit:

- schema validate;
- validate references/provenance;
- enforce horizon write boundary;
- reject attempts to create canonical facts/events/actions;
- validate provisional material through #26;
- reject stale world/event basis.

Invalid output changes nothing.

Allow at most one bounded repair pass for structural/reference mistakes if consistent with existing model-generation conventions. No open-ended retry loop.

Planner failure leaves the previous valid plan intact and never rolls back authoritative gameplay.

## Initial planning

Once player setup and the generated starting region/world are established, generate the initial high/medium/low plan from:

- campaign/setting guidance;
- player-established life/goals;
- generated locality/NPCs/institutions;
- current pressures/processes;
- situation candidates/opening guidance;
- presentation/storytelling guidance.

Do not hardcode one Awakening Earth plot.

The planner should prefer established NPCs, relationships, places, consequences, factions, mysteries, and callbacks over gratuitous novelty when those existing elements can support satisfying play.

## Mystery and knowledge boundaries

Protected planner context may include hidden canonical truth when legitimately relevant.

The planner must keep separate:

- canonical hidden truth;
- player knowledge;
- actor/group beliefs;
- grounded revelation opportunities.

Knowing a secret does not authorize leaking it into actor/player context.

A revelation still requires perspective-safe discovery/communication through ordinary systems.

## Context isolation

Plan material is available only to authorized planner/privileged orchestration/debug contexts.

Actor/player context must not expose:

- threads;
- assumptions;
- provisional GM details;
- possible developments/end states;
- player-interest diagnostics;
- planner rationale.

Plan-derived material enters scene reasoning only as **attention guidance**. It is never an instruction that a specific event must occur.

## Diagnostics

Every plan revision should expose developer-only diagnostics including:

- plan revision before/after;
- authoritative world/event basis;
- signals consumed;
- horizons reviewed;
- assumptions evaluated/invalidated;
- thread changes;
- interest-signal changes;
- provenance/rationale;
- escalation requested/accepted;
- model/validation results;
- confirmation that no canonical world/event mutation occurred.

The #16 harness should be able to inspect and replay these diagnostics where available.

## Schema versioning

Planner state has an independent schema version.

For the first implementation:

- support schema version 1;
- reject unknown future versions clearly;
- legacy/test saves without planner state may initialize only through an explicit planner-initialization path;
- do not silently fabricate a historical plan for an old checkpoint.

## Framework boundary

### Engine

Owns generic:

- planner contracts/schemas;
- planner persistence ports;
- revisions/concurrency;
- planning signals and horizon escalation;
- protected planner context integration;
- diagnostics.

### Campaign/content

May provide themes, starting conflicts, secrets, agendas, authored seeds, and planning guidance. Campaign source content remains immutable.

### Presentation/storytelling guidance

May influence genre expectations, pacing, tone, and thematic emphasis. It cannot change truth.

### Ruleset/setting/adapter

Provide ordinary authoritative mechanics/ontology inputs. They do not own campaign direction.

### LLM planner

Proposes plan mutations only. It has no direct world mutation authority.

## Verification scenario

Use deterministic scripted planner output through the same structured contract used by production.

Start with grounded Awakening Earth material including several threads and one explicit player goal.

1. Generate and persist an initial high/medium/low plan.
2. Verify creating/revising the plan changes no World State/history.
3. Player makes a meaningful unexpected choice that invalidates a low assumption.
4. Batch resulting development signals.
5. Deterministic assumption validation detects the contradiction.
6. Run a low planner pass.
7. Low revises relevant material and requests medium escalation.
8. Run a separate medium pass.
9. Medium changes; high remains unchanged.
10. Planner/GM context sees revised attention.
11. Player/NPC contexts receive no hidden plan material.
12. Later NPC/world consequences execute through normal action/simulation systems.
13. Save a checkpoint, continue and replan, then branch from the old checkpoint.
14. Verify the earlier branch's plan is restored.
15. Use planner/#16 diagnostics to explain every change.

## Acceptance criteria

- planner state persists separately from `WorldState`, events, and beliefs
- independent plan revision and authoritative basis are recorded
- plan changes do not increment world revision or create canonical events
- checkpoint branches snapshot/restore corresponding planner state
- one versioned document contains linked high/medium/low horizons
- threads have stable grounding, priority, horizon, and active/dormant/retired lifecycle
- thread promotion/demotion changes attention only
- machine-checkable assumptions are validated deterministically
- invalid assumptions generate targeted planning signals
- possible developments remain conditional
- explicit player goals strongly influence planning
- inferred interests require meaningful accumulated evidence
- ignored optional threads can diminish/become dormant
- planning signals cite canonical causes and are batched
- replanning starts at the lowest affected horizon
- lower horizons cannot directly rewrite higher horizons
- escalation requires a separate structured pass
- planner output is validated structured mutations rather than prose replacement
- stale/invalid proposals change neither plan nor world
- planner failures preserve prior plan and do not roll back gameplay
- initial planning is grounded in generated campaign/player/world state
- established material/callbacks are preferred over arbitrary novelty where appropriate
- mysteries preserve truth-vs-knowledge boundaries
- planner material is available only to authorized GM/planner/debug context
- player/NPC contexts cannot retrieve hidden plan material
- planning guides attention rather than forcing events
- NPC/world actions still execute through normal systems
- diagnostics explain triggers, assumptions, thread changes, and escalation
- schema/version validation is explicit
- deterministic tests use the same structured planner contract as production
- architecture tests prove plan revision cannot mutate canonical truth
- `npm run check` passes

## Non-goals

- fixed plot or quest sequence
- guaranteed climax/ending
- perfect autonomous campaign director
- planner invocation after every action
- direct planner control of NPC/world state
- exposing hidden plans to players
- replacing #26 content/commitment rules
- implementing every Awakening Earth arc
- final planner-model/prompt optimization
