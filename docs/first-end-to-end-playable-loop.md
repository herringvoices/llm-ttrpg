# First End-to-End Playable Loop

**Status:** Settled and implemented by Issue #19
**Scope:** The smallest desktop vertical slice that proves the existing engine, reference game, model runtime, persistence, NPC interaction, lazy simulation, diagnostics, and campaign-planning seams combine into an actual playable local game.

## Implemented integration

- `DesktopPlaySession` is the reusable application boundary above engine sessions and below React. It routes freeform declarations into the existing #11 action or #14 conversation orchestration, prevents concurrent submissions, preserves post-commit retry identity, and never mutates `WorldState` itself.
- The desktop application generates a starting region through the provider-neutral structured model runtime, realizes the opening incident through #18, stores a bounded generated-package descriptor, and reconstructs the same runtime package when a persisted world is reopened.
- The React shell provides campaign create/open, transcript, freeform input, location/time, narration preference, processing/error states, explicit save/return, a three-day catch-up affordance, and development-only diagnostics.
- The application initializes #28's grounded three-horizon plan and runs a targeted lowest-horizon planner pass when deterministic assumption validation finds a contradiction. Plan context remains protected.
- Migration `0008_playable_loop.sql` stores only non-authoritative application continuity: generated-package reconstruction data, narration preference, and the bounded transcript. Migration `0009_campaign_generation_drafts.sql` adds durable, stage-checkpointed setup drafts so generation failures, restarts, upgrades, and follow-up questions resume without discarding accepted work. Authoritative outcomes remain in ordinary engine persistence.
- `tests/desktop-playable-loop.test.ts` covers generated create/open, resumable generation and question pauses, opening realization, action execution, planner invalidation, save/reopen, three-day catch-up, model-unavailable recovery, and narration retry without duplicate execution.

## Goal

Issue #19 is an integration milestone, not a new game-system milestone.

The player must be able to create or load an Awakening Earth campaign, play through a small generated supernatural situation using freeform text, interact with NPCs from their actual perspectives, leave the local scope, allow meaningful fictional time to pass, return to grounded catch-up consequences, save, close, reopen, and continue consistently.

The milestone proves the project's central premise:

> **Freeform player intent + bounded model context + deterministic authority + persistent world consequences can feel like playing a tabletop RPG rather than driving a scripted dialogue tree.**

#19 should compose existing systems rather than replacing them.

## Ownership Boundary

#19 owns:

- the minimal player-facing desktop shell needed to play the vertical slice;
- application/session orchestration across the already-implemented engine seams;
- player-visible turn lifecycle and error states;
- development-only integration diagnostics surfaced from the harness/runtime;
- save/load continuation through the playable UI;
- the repeatable end-to-end acceptance scenario;
- final integration of campaign planning once #28 is available.

#19 does **not** own:

- a second player-action pipeline;
- a second conversation system;
- a second simulation/catch-up implementation;
- a second model-runtime abstraction;
- new reference-game rules;
- planner schemas or planner behavior that belong to #28;
- a generic quest runtime;
- graphics or production presentation polish;
- autosave/checkpoint architecture.

If an unfinished dependency does not yet expose a needed integration seam, #19 may define the consumer-facing interface it needs and use a test/mock adapter temporarily. It must not reproduce the dependency's internal responsibility.

## Dependency Strategy

The design is ready before every implementation dependency is complete.

### Implemented foundations

#19 consumes the existing outputs of:

- #5 Project Shell & Persistence Foundation
- #6 World State, Fictional Time & Event History
- #7 Action Pressure & Executable Intent
- #8 Checks, Resolution & RNG
- #9 Hierarchical Tool Catalog
- #10 Context Assembly & Knowledge Retrieval
- #11 Player Action Execution Pipeline
- #12 Lazy World Simulation & Catch-Up
- #13 NPC State, Knowledge, Goals & Relationships
- #15 Local LLM Runtime Adapter
- #17 Starting Region Generation & Local World Seeding
- #18 Reference Game Rules & World Model Integration
- #21 Core Game Rules & Resolution Model
- #22 Character Progression & Abilities
- #23 Setting & World Premise
- #24 Institutions, Economy & Society
- #25 Player Fantasy & Starting Situation
- #26 Content & Encounter Principles
- #27 Game Package Contracts & Content Model
- #34 Character & Creature Mechanical Generation
- #35 Monster Design, Threat Calibration & Encounter Composition

### Integrated dependencies

- **#14 NPC Interaction & Conversation:** #19 consumes its headless conversation/orchestration and narration-preference seam; the desktop app adds no alternate conversation logic.
- **#16 Simulation & Test Harness:** #19 consumes its scripted-model and trace/inspection surfaces for acceptance testing.

### Integrated planning dependency

- **#28 Campaign Planning & Narrative Direction:** #19 consumes the implemented persisted plan, deterministic assumption validation, targeted replanning, and perspective isolation seams.

## Reference-Game Boundary

The milestone proves the generic engine by running one explicit game composition:

- Awakening Earth ruleset;
- Awakening Earth setting;
- the pair-specific Awakening Earth setting adapter;
- the first generated campaign;
- the selected narration/presentation guidance.

Package identities must remain explicit.

Reference-game-specific rules, setting facts, incident realization, character/creature mechanics, campaign content, and narration guidance must come through package boundaries. Core orchestration may not hard-code Awakening Earth facts or the deterministic fixture's names.

A second fantasy test pack is not required by #19.

## Acceptance Scenario Philosophy

The acceptance scenario has a **deterministic starting fixture and required milestones**, not a mandatory script of player commands.

Automated verification may use known declarations and scripted/mock model outputs to reproduce exact behavior.

Manual/semi-automated playtesting must deliberately vary player actions enough to prove the loop is not rails disguised as freeform text.

The same production schemas, validators, operations, authority boundaries, and persistence paths must be used by the deterministic fixture and the real local-model path.

## Canonical Vertical-Slice Scenario

### 1. Create the campaign

From the desktop app, start a new Awakening Earth campaign.

For the deterministic acceptance fixture, use the existing reference-game starting-region generation path and a small ordinary starting locality such as the Brownbag Groceries-style fixture already used by the reference-game integration tests.

The production UI must still support natural-language setup input rather than exposing the deterministic fixture as the only campaign.

The created save records the explicit game-package composition and initializes ordinary authoritative World State.

### 2. Enter the initial locality

The player begins in the generated detailed starting locality with:

- an ordinary current location;
- current fictional time;
- a small number of materially relevant instantiated NPCs;
- coarse surrounding world truth;
- no pre-generated encyclopedia of the settlement;
- no canonical supernatural incident merely because an opening brief mentions one.

The player-visible screen renders only perspective-safe information.

### 3. Realize the opening supernatural incident

Use #18's existing opening-incident realization path.

The deterministic test path may return a known valid structured incident proposal from a scripted model response, but the incident may not be hard-coded into core orchestration.

Before narration presents persistent incident details, the required entities/facts/events/constraints must be validated and committed.

When the incident includes a player-facing creature, it must satisfy the existing #34/#35 realization and challenge boundaries.

### 4. Execute a freeform physical response

The player enters a natural declaration rather than selecting a menu action.

The deterministic scenario should include one declaration whose fiction exercises more than a trivial attack command, for example using an ordinary environmental object to push, obstruct, trap, distract, or otherwise affect the supernatural threat.

The turn must prove:

- freeform intent interpretation;
- Action Pressure/horizon enforcement;
- bounded context assembly;
- relevant tool discovery rather than whole-catalog dumping;
- automatic/impossible/uncertain resolution as appropriate;
- Awakening Earth's mundane-vs-magical interaction semantics;
- authoritative operation/check execution;
- fictional-time advancement;
- compact meaningful event recording;
- narration generated from committed outcomes rather than used as authority.

The exact player wording is fixture data, not a special engine branch.

### 5. Manifest and use the first power

The deterministic fixture uses the existing **Invincible** first-power path.

The player is not initialized as already awakened.

The scenario proves:

- the first-awakening/manifestation operation executes through ordinary rules machinery;
- the resulting mechanical realization persists;
- power use resolves through the existing engine/adapter boundary;
- generated narration does not add mechanical effects beyond the committed result.

### 6. Hold a real NPC conversation

Use #14's conversation seam with at least two differently informed NPCs or one informed and one uninformed NPC.

The scenario must demonstrate:

- freeform described or quoted speech;
- actor-perspective context;
- no leakage of hidden canonical truth;
- structured NPC decision separated from final prose;
- at least one durable communication/belief/social consequence when materially justified;
- no durable record for every line of dialogue;
- no invented player choice after control should return.

A social check is required only if the chosen test beat contains genuine material uncertainty.

### 7. Resolve or leave the immediate situation

The acceptance path must not require one canonical solution.

For automated testing, one deterministic solution may be exercised.

For manual/semi-automated verification, at least one materially different approach should also be attempted, such as confrontation, containment, retreat, institutional contact, or environmental manipulation.

The resulting state must remain explainable from authoritative operations/events rather than narration.

### 8. Leave the local simulation scope

The player moves away from the initial locality through ordinary game/application flow.

This transition must identify which simulation scope is becoming inactive/relevant without creating a special "quest complete" state.

### 9. Advance meaningful fictional time

Advance **three fictional days** in the deterministic scenario.

This is deliberately long enough that sleeping systems and scheduled/local processes can matter.

The initial locality must not continuously simulate every actor while absent.

### 10. Return and run lazy catch-up

On return, execute #12's ordinary catch-up path for the relevant scope and prerequisites.

The deterministic fixture must produce at least one grounded persisted consequence that is observable on return, such as:

- an institutional response to the supernatural incident;
- a pressure/process change;
- an NPC or local-resource consequence;
- another established world process advancing.

The consequence must be derived from canonical state/processes/events and must survive reload.

The narrator may present the result but may not invent the change.

### 11. Invalidate a near-term GM assumption

Once #28 is available, the deterministic or semi-automated scenario includes one meaningful player choice that invalidates a low-horizon planning assumption.

Acceptance requires:

- targeted replanning beginning at the lowest affected horizon;
- low horizon revised;
- medium horizon revised only if actually affected;
- high horizon preserved unless the campaign direction genuinely changed;
- no canonical World State/event mutation merely because the plan changed;
- later GM-facing context sees the revision;
- ordinary player/NPC context cannot retrieve the hidden plan.

The exact unexpected choice is fixture data. Core application code must not recognize a magic phrase or branch.

### 12. Save, close, reopen, continue

Create a normal persisted save/checkpoint through the existing persistence boundary, close the active session/application, reopen the same world, and continue play.

Verify preservation of at least:

- package composition;
- current fictional time;
- current location/relevant entities;
- mechanical realization/power state;
- material facts/events;
- NPC beliefs/social consequences established during the scenario;
- lazy-simulation consequences;
- planner state once #28 is integrated.

The reloaded game must be playable through the same freeform input path.

## Minimal Player UI

The milestone should stay intentionally small.

### World screen

Provide:

- existing world list;
- create/new-game action;
- natural-language setup input sufficient for starting-region generation;
- open/load action for an existing world;
- clear loading and failure states.

A mandatory confirm-every-generated-detail loop is not required.

### Play screen

Provide:

- scrollable narrative/conversation transcript;
- freeform player-input box;
- submit/continue control;
- current location label;
- current fictional date/time;
- narration-length preference from #14: Concise / Standard / Expansive;
- an unobtrusive processing state while a turn is running;
- save and return/quit affordance.

Do **not** require for this milestone:

- map graphics;
- character-sheet UI;
- inventory UI;
- quest log;
- dialogue choices;
- combat HUD;
- raw Action Pressure number in the player UI;
- exposed tool/check internals.

If a rules interaction requires information that has no dedicated production UI yet, narrative output may communicate the necessary player-visible result.

## Transcript Boundary

The visible transcript is presentation/interaction continuity, not a second source of truth.

- recent player-authored quotes and final NPC/narrator lines may be kept verbatim for immediate continuity;
- older interaction material may compact according to #14;
- canonical consequences live in ordinary facts/events/beliefs/social/mechanical state;
- model-generated prose is not replayed as authority;
- full prompts/context packages must not be copied into canonical event history.

If durable transcript persistence is added for player convenience, it must remain clearly non-authoritative and separately bounded.

## Player Turn Lifecycle

The desktop application should expose a single player turn as an application-level lifecycle rather than embedding engine logic in React components.

Conceptually:

1. accept one player declaration;
2. snapshot/identify the current world revision;
3. assemble authorized situation/context;
4. interpret executable intent and communication semantics;
5. resolve/commit player consequences through existing authority machinery;
6. rebuild context after meaningful commits;
7. run relevant NPC reasoning/actions through #14;
8. run any required immediate reaction chain until a stop boundary;
9. trigger only the simulation/planning work justified by the committed developments;
10. generate final player-facing prose from authorized/committed material;
11. persist required durable state;
12. return a presentation result plus development trace reference.

Exact function names may differ.

The UI must not directly mutate World State.

## Failure and Retry Behavior

The playable loop must fail safely.

### Before authoritative commit

If context assembly, model inference, structured-output validation, tool selection, or proposal validation fails before an authoritative commit:

- no partial canonical mutation may remain;
- the player receives a recoverable error state;
- retry may re-run from the still-current world revision.

### After authoritative commit

If a later presentation/narration step fails after canonical consequences have already committed:

- do not replay the action automatically;
- do not roll back committed world truth merely because prose failed;
- the application should recover by rebuilding from the new world revision and allowing narration/presentation to be retried safely.

### Duplicate submission

While a turn is executing:

- prevent accidental duplicate submission of the same UI action;
- do not rely on disabled UI alone for authority/idempotency guarantees already owned by lower layers.

### Model unavailable

If the local runtime is unavailable or misconfigured:

- show a clear actionable local error;
- preserve the save;
- do not silently fall back to fabricated narration or random behavior.

### Load failure

A failed load must not overwrite or reinitialize the save automatically.

## Development Diagnostics

Development builds should expose a collapsible diagnostics surface backed by #16 rather than bespoke console-only logging.

For each player turn, make the following inspectable when available:

- input declaration;
- starting world revision;
- fictional time before/after;
- Action Pressure and executable horizon;
- interpreted intent/communication acts;
- assembled-context character/token estimate and inclusion summary;
- retrieved historical-event count;
- selected/discovered tool IDs;
- model-call role/type and phase timings;
- checks/resolution results;
- executed operations;
- committed mutations/events;
- catch-up scopes/processes;
- planner trigger/revision summary once #28 is integrated;
- resulting world revision;
- final stop reason;
- narration/presentation phase status.

Diagnostics may expose hidden/GM information only in explicit development surfaces. They must never be mixed into normal player context.

## Performance Policy

Local-model latency varies too much by hardware and model to impose a useful universal seconds-per-turn acceptance threshold now.

Instead, #19 must:

- keep the UI responsive while work is running;
- expose phase timings in development diagnostics;
- distinguish model time from deterministic engine/persistence time;
- avoid unnecessary full-world/full-history retrieval;
- avoid unnecessary repeated model calls caused by UI orchestration;
- make pathological slow phases identifiable.

Final model optimization is outside #19.

## Save/Context Growth Sanity Checks

#19 must make growth observable without prematurely imposing arbitrary byte limits.

The diagnostics/harness should be able to report, at minimum when technically available:

- entity count;
- canonical fact count;
- belief/social-state counts;
- event count;
- document count;
- simulation-scope/cursor count;
- mechanical-realization count;
- current database/save-file size;
- most recent assembled-context serialized size;
- number of history records retrieved for the most recent turn.

The vertical slice should be inspected for obvious amplification problems.

Architectural guardrails:

- do not persist full prompts as canonical events;
- do not persist complete model context packages as canonical history;
- do not create one durable NPC memory per dialogue line;
- keep event records compact and causal;
- continue using bounded retrieval;
- do not add frequent autosave checkpoints in #19.

Checkpoint/history deduplication or long-campaign compaction may be addressed separately if needed. This milestone should not make the current snapshot amplification problem worse by introducing high-frequency autosave.

## Harness and Acceptance Testing

### Headless deterministic scenario

Using #16, provide a repeatable scenario that can run without manually using the normal UI.

It should use deterministic seeds and scripted/mock model responses where needed while exercising production schemas and authority boundaries.

The scenario must cover:

1. campaign creation;
2. opening incident realization;
3. freeform player action;
4. at least one uncertain/impossible/automatic rules path as appropriate;
5. first awakening/power use;
6. NPC interaction;
7. departure;
8. three-day fictional-time advancement;
9. return/catch-up;
10. persisted consequence;
11. targeted replanning once #28 exists;
12. save/reload;
13. post-reload continuation.

### Desktop smoke path

Exercise the same scenario through the actual desktop application far enough to prove:

- create/load navigation works;
- player input reaches the application orchestration;
- transcript updates from returned presentation results;
- save/reload reconnects to the same persisted world;
- diagnostics can inspect the turn.

### Exploratory off-script playtest

Before #19 is considered done, deliberately deviate from the automated happy path.

At minimum:

- attempt a materially different response to the opening incident;
- ask an NPC a question not present in the deterministic script;
- refuse or ignore at least one obvious hook/opportunity;
- verify the engine either handles the declaration through existing systems or fails safely without inventing canonical shortcuts.

This is a milestone test for flexibility, not a requirement to support every imaginable action.

## Acceptance Criteria

### Player loop

- [x] a player can create a generated Awakening Earth campaign from the desktop app
- [x] a player can open an existing campaign
- [x] the play screen accepts freeform text rather than dialogue/action menus
- [x] current location and fictional time are visible
- [x] Concise/Standard/Expansive narration preference is usable
- [x] one opening incident is realized through #18 rather than hard-coded as canonical app state
- [x] a freeform physical response resolves through Action Pressure, context/tool discovery, rules, persistence, and narration
- [x] first Awakening/Invincible manifestation executes through ordinary reference-game rules
- [x] NPC conversation executes through #14 with perspective-safe cognition and no player-control theft
- [x] the player can leave the initial locality
- [x] three fictional days can pass
- [x] returning triggers #12 catch-up and exposes at least one grounded persisted consequence
- [x] save, close, reopen, and continued play preserve the world correctly

### Authority and framework boundaries

- [x] no canonical change depends solely on narration text
- [x] UI components do not mutate World State directly
- [x] no parallel conversation, action, simulation, or planner truth store is introduced
- [x] knowledge restrictions hold through NPC interaction
- [x] mechanically relevant people/creatures densify through #34 without retconning prior truth
- [x] the player-facing creature demonstrates coherent #35 signature/tell/counterplay requirements without world-wide level scaling
- [x] reference-game-specific behavior enters through explicit package boundaries
- [x] the engine/application orchestration contains no special branch for the deterministic fixture's incident, creature, location, or exact player wording

### Planning integration

- [x] #28's minimal high/medium/low plan persists with the save
- [x] one meaningful unexpected choice invalidates a near-term assumption
- [x] replanning revises the low and only affected higher horizons
- [x] later GM-facing context reflects the revision
- [x] player/NPC context cannot retrieve hidden plan state
- [x] plan revision alone changes neither authoritative World State nor event history
- [x] planned NPC/world developments still resolve through ordinary simulation/operation boundaries

### Reliability

- [x] pre-commit model/validation failures leave no partial canonical mutation
- [x] post-commit narration failure does not duplicate or erase the committed action
- [x] duplicate UI submission is prevented while a turn is active
- [x] unavailable local model produces a recoverable visible error
- [x] failed save load does not overwrite/reinitialize the save

### Diagnostics and growth

- [x] the development trace can inspect context selection, tools, checks, mutations, events, time advancement, catch-up, and resulting revision
- [x] phase timings distinguish model work from deterministic engine/persistence work
- [x] basic save/world growth counters are inspectable
- [x] full prompt/context payloads are not recorded as canonical event history
- [x] the milestone does not introduce high-frequency autosave checkpoints

### Verification

- [x] #16 can run the deterministic end-to-end scenario without the normal player UI
- [x] the desktop app passes a create/play/save/reload smoke path
- [x] an off-script exploratory playtest demonstrates at least one alternate incident response and one unplanned NPC question
- [x] `npm run check` passes

## Non-Goals

- graphics, portraits, maps, or animation
- production visual polish
- final character-sheet/inventory UI
- quest log or objective tracker
- dialogue trees
- complete progression/combat/economy breadth
- every Awakening Earth power, monster, institution, or campaign arc
- final model/provider optimization
- universal performance SLA across local hardware
- autosave strategy
- long-campaign checkpoint compaction
- a sophisticated autonomous campaign director beyond #28's first seam
- a second ruleset/setting validation pack

## Suggested Codex Implementation Slices

These are sequencing guidance, not new ownership boundaries.

1. **Application play-session seam**  
   Add a reusable application-level turn/session contract above the engine and below React. Keep React presentation-only.

2. **New/load/play navigation**  
   Extend the current desktop shell from world creation/listing into opening and playing a persisted world.

3. **Turn rendering and freeform input**  
   Connect player declarations to the existing action/model orchestration and render returned presentation results.

4. **#14 conversation integration**  
   Consume the conversation seam and narration preference when #14 lands.

5. **#16 trace integration**  
   Render a development diagnostics panel from harness/runtime trace data rather than inventing a second tracing model.

6. **Location departure, time jump, and catch-up path**  
   Wire the existing simulation boundary into the playable session and deterministic fixture.

7. **Save/reload continuation and failure recovery**  
   Prove committed state survives application lifecycle and retries cannot duplicate committed actions.

8. **#28 planner integration**  
   When #28 lands, wire its persisted plan/trigger/replanning seam into the same orchestration without making planning authoritative.

9. **End-to-end acceptance suite and exploratory playtest**  
   Lock the deterministic scenario and verify at least one materially off-script route.

## Done Means

#19 is done when a person can launch the desktop app, start or load the reference game, type ordinary language, experience a coherent supernatural/NPC situation whose consequences are authoritative and persistent, leave and return to a world that changed for grounded reasons, close the app, reopen it, and continue.

At that point the project does not merely contain the components of an LLM-assisted TTRPG.

It contains a playable one.
