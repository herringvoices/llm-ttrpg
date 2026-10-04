# Content & Encounter Principles

**Status:** Settled and implemented by Issue #26 — Content & Encounter Principles
**Scope:** How authored content, world simulation, NPC goals, generated detail, protected GM planning, and perspective-aware presentation combine to create discoverable situations without a rigid quest tree or uncontrolled narration.

## Goal

The game should behave like a good human GM operating over a persistent simulation.

The world contains authoritative facts, actors, pressures, processes, events, and beliefs. The GM layer may notice interesting combinations, sketch possibilities, fill genuinely undefined space, and decide how grounded opportunities could come into view. It may not silently rewrite established truth or force planned developments to happen.

The central rule is:

> **The world contains facts. The GM plan contains possibilities and intentions. Undefined space may be filled when needed, but once a detail becomes observable or causally relevant it must be committed as authoritative state before anything relies on it.**

## Core Model

### Canonical world truth

Authoritative World State, meaningful event history, actor/group beliefs, social state, rules state, and committed generated content remain the source of truth.

Canonical does not mean universally known. A fact may be hidden from the player and from most NPCs while still being true.

### Coarse canonical truth

A record may be authoritative without being fully detailed.

Example:

> Brownbag Groceries exists, is locally owned, employs about twenty people, and has aging refrigeration equipment.

That does not require the exact compressor model, every employee, or the condition of every freezer to already exist.

Later detail may be generated only within the constraints established by the coarse truth.

### Provisional GM detail

Protected GM-facing reasoning may propose details that have not yet become true.

Examples:

- a particular freezer may be close to failure;
- a specific employee may be considering quitting;
- an ordinary customer may be buying suspicious quantities of salt because of a supernatural problem;
- an unrevealed family member, debt, rivalry, clue, or local complication may be useful to develop later.

A provisional detail:

- is not authoritative World State;
- is not an event;
- is not actor knowledge;
- is not available to player/NPC perspective retrieval;
- may be revised, replaced, merged, or discarded while nothing authoritative depends on it.

Issue #28 owns persistence and revision of protected GM plans. Issue #26 defines what provisional material means and when it stops being provisional.

### Presentation-only detail

Narration may invent transient color that does not constrain future state: phrasing, gestures, sensory texture, incidental crowd behavior, or other disposable presentation.

If an invented detail would matter later, identify a person/place/object, establish a relationship or motive, create a resource or obligation, reveal a clue, explain an event, or affect a decision, it is no longer presentation-only. It must be grounded in existing canon or pass through the commitment boundary.

## Commitment Boundary

A provisional detail must be validated and committed through ordinary authoritative-state/generation boundaries **before** any of the following occur:

1. the player or another actor can perceive it as a persistent fact;
2. an NPC or institution relies on it when selecting an authoritative action;
3. it is communicated in a way that establishes a durable belief, memory, testimony, document, or event;
4. a rules operation, world process, catch-up step, or other simulation behavior uses it causally;
5. a canonical mutation, event, belief, relationship, commitment, mechanical constraint, or other durable record is derived from it;
6. later authoritative state would need the detail in order to explain an already committed consequence.

Commitment is **generate/validate -> apply -> persist -> expose/use**, never narration -> retroactive truth.

After commitment, existing no-retcon rules apply. Later generation may densify unspecified portions, but it may not contradict committed facts, observations, mechanics, or consequences.

### Claims and false beliefs

A character revealing a claim does not make the proposition universally true.

If Gary says, "My daughter works at the hospital," the canonical consequences may include:

- Gary made that statement;
- Gary believes he has a daughter who works at the hospital;
- the player heard the statement.

Whether the daughter actually exists and works there depends on what was committed before the statement. If the GM intends Gary to be truthful about a previously provisional detail, the underlying person/relationship/employment facts must be committed first. If Gary is mistaken or lying, the belief/testimony is canonical while the proposition may be false.

This preserves the existing separation between world truth, actor beliefs, player knowledge, and hidden GM planning material.

## Situations

A **situation candidate** is a non-authoritative GM-facing framing of grounded circumstances that may deserve player-facing attention.

Examples:

- an employee is considering quitting because of worsening conflict with a manager;
- aging refrigeration plus a cash-strapped owner creates risk of inventory loss;
- unusual purchasing behavior may be a clue to a supernatural pressure;
- two NPC goals are beginning to conflict;
- a simulated shortage creates opportunities for several actors;
- a monster pressure is moving toward a populated area.

A situation candidate may reference:

- authoritative entities, facts, events, beliefs, actor goals, relationships, commitments, pressures, processes, and rules state;
- provisional details that remain explicitly non-authoritative;
- conditional possible developments;
- grounded ways the player might discover the situation.

The situation itself is **not** a competing World State object and does not become true merely because the GM plans around it.

Issue #28 may persist situation candidates or narrative threads inside protected campaign-plan state. #26 does not introduce a canonical situations table.

## Three Content-Generation Patterns

The implementation must support at least these three patterns.

### 1. Authored seed

Campaign content deliberately supplies material that can later become relevant.

Authored material may include:

- hard canonical starting facts;
- hidden canonical starting facts;
- coarse constraints;
- pressures/processes;
- optional GM-facing seeds or possibilities.

Authored possibilities do not become events merely because they appear in campaign content.

Example:

> The store owner is under financial pressure.

may be canonical.

> A refrigeration failure could turn that pressure into a crisis.

may remain a possible development.

### 2. Simulation-emergent situation

The GM recognizes an interesting combination that already exists in authoritative state.

Example:

- an NPC has a goal to keep their job;
- their manager's relationship toward them is deteriorating;
- the store is cutting hours;
- the NPC has missed rent.

No quest author needs to declare "Help Nina Keep Her Job." The GM may recognize a social/economic situation from the existing state and decide it deserves low-level attention.

### 3. Query-driven local generation

When play reaches under-specified space, the game may generate the smallest additional detail required to support the current interaction.

Example:

Brownbag is canonical but its individual freezers are not. If a close-level GM plan wants to surface an equipment problem, a generation pass may propose one specific freezer and its condition under the store's established constraints.

The proposed detail remains provisional until needed. Before the player observes leaking coolant, before an employee acts because the freezer is failing, or before a world process spoils inventory, the required details must be validated and committed through the same no-retcon generation principles established by #17.

This is progressive realization, not permission to rewrite the location.

## Hooks and Discovery Affordances

A **discovery affordance** (or hook) is a grounded, perspective-safe way a situation could come into view.

Examples include:

- direct observation;
- an NPC conversation or request;
- overheard speech;
- a public notice or news item;
- a visible environmental change;
- institutional contact;
- a rumor held by an appropriate actor/group;
- a consequence produced by ordinary simulation.

Hooks are not canonical quest markers and do not obligate engagement.

Before a hook is surfaced:

1. every persistent detail required for the hook must already be canonical or be committed through a validated generation/state-change boundary;
2. the selected perspective must be allowed to perceive or know the surfaced information;
3. hidden world truth that the perspective does not know must not leak through hook phrasing;
4. any NPC statement must be grounded in that NPC's knowledge/beliefs or intentionally modeled deception.

The close-level GM plan chooses among valid opportunities based on current location, active threads, player interests, NPC/world goals, and current circumstances. That prioritization belongs to #28.

## Ignoring, Engaging, Succeeding, and Failing

A hook does not create a special quest runtime.

If the player ignores it, nothing automatically fails merely because a hook was offered.

Underlying canonical pressures, goals, commitments, schedules, and world processes continue according to their own rules. A provisional possibility that was never committed may simply be revised or discarded.

If the player engages, their actions use the ordinary player-action pipeline, NPC reasoning, rules operations, simulation, and persistence boundaries.

A situation does not own its outcome.

After authoritative changes occur, the GM/planner may reinterpret the state:

- the situation may be resolved;
- it may become worse or better;
- it may split into several threads;
- another actor may solve it;
- it may become irrelevant;
- the same underlying conditions may later create another situation candidate.

Failure produces ordinary consequential state. It is not a reset instruction.

Recurring content requires no special recurring-quest abstraction. If the conditions that generated a situation recur, the content/planning layer may recognize another candidate.

## Escalation and Possible Developments

The GM may reason about conditional possible developments:

- "If the freezer remains unfixed, food loss becomes more likely."
- "If Nina loses more hours, she may seek another job."
- "If the salt buyer's problem worsens, supernatural evidence may become easier to notice."

These are planning statements, not scheduled facts.

When a development can be represented by an existing world process, actor goal, commitment, scheduled trigger, or simulation rule, that mechanism owns whether it occurs.

The planner may increase or decrease narrative attention around a grounded possibility, but it may not manufacture the event to preserve pacing.

## Authority Matrix

### Campaign/content authors may

- establish canonical starting material;
- establish hidden canonical truth;
- define coarse constraints, pressures, processes, and reusable seeds;
- provide optional protected GM guidance.

They may not define mandatory player routes or treat an unexecuted future event as already true.

### Protected GM/planner model calls may

- recognize interesting combinations of canonical state;
- propose provisional details;
- propose possible developments;
- propose grounded discovery affordances;
- decide what material deserves attention.

They may not mutate World State or expose provisional material directly to ordinary player/NPC perspectives.

### Generation/densification calls may

- fill genuinely undefined space under existing constraints;
- propose entities/facts/social detail needed for play.

Their output becomes usable truth only after schema validation, canonical/coherence validation, no-retcon checks, and authoritative commit.

### Actor/NPC reasoning calls may

- reason from the actor's authorized context and beliefs;
- select intentions/actions.

If a hidden provisional detail is needed to motivate that action, it must be committed into the appropriate authoritative fact/social/belief state before the action is selected or resolved.

### Narration calls may

- choose wording, emphasis, sensory framing, and disposable color;
- describe committed outcomes.

They may not create persistent facts or consequences.

## Boundary With Other Issues

### #17 Starting Region Generation

#17 establishes coarse and detailed starting truth, pressures, knowledge distribution, processes, and no-retcon densification.

#26 consumes those concepts as content sources and extends the same commitment rule to later GM-driven local detail.

### #13 NPC State, Knowledge, Goals & Relationships

#13 owns durable NPC social state and knowledge boundaries.

#26 may recognize situations from those goals/relationships and may surface hooks through NPCs, but it does not create a second NPC-state model.

### #14 NPC Interaction & Conversation

#14 owns conversation turn mechanics, NPC decisions, memory extraction, and conversational consequences.

#26 only establishes that conversational hooks and claims must respect committed truth and the speaker's perspective.

### #28 Campaign Planning & Narrative Direction

#26 answers:

> What material can exist, how can it be generated, when must it become canonical, and how can it be discovered?

#28 answers:

> Which grounded material deserves attention now, and how is that direction maintained across high, medium, and low horizons?

#28 owns planner persistence, prioritization, replanning triggers, thread status/retirement, and horizon schemas.

### #35 Monster Design, Threat Calibration & Encounter Composition

#26 owns why a supernatural situation exists, how it becomes discoverable, and what happens when it is ignored or engaged.

#35 owns the design/audit of deliberately player-targeted monster challenges.

### #18 / #19

#18 integrates these principles into the reference-game vertical slice. #19 proves them end to end in playable form.

## Implementation Contract

Issue #26 should add the smallest reusable code seam necessary for later GM planning and playable integration without implementing #28 itself.

### Generic engine contracts

Add game-agnostic, non-authoritative content-planning contracts alongside the existing content/generation contracts. Exact internal names may vary, but the implementation must represent and validate:

- **grounding references** to authoritative source material;
- **provisional details** with stable IDs and provenance/constraints;
- **situation candidates** with a source pattern, summary, canonical grounding, optional provisional detail references, optional conditional developments, and discovery affordances;
- **discovery affordances** with their grounding, perspective requirements, and any provisional details that must be committed before surfacing;
- **commitment evidence** linking a formerly provisional detail to the canonical records that now establish it.

These contracts are not World State and must not be added to ordinary canonical persistence in #26.

Provide deterministic helpers/validation that can answer at least:

- is this situation candidate structurally grounded?
- does this discovery affordance depend on any still-provisional detail?
- what canonical references establish a committed detail?
- can this hook be handed to perspective-aware orchestration without exposing uncommitted material?

Do not create a generic "commit prose" operation. Canonicalization must resolve into existing validated entity/fact/belief/social/event/mutation/generation mechanisms.

### Reference-game content source

Add a small reference implementation capable of building situation candidates from Awakening Earth local state.

It should demonstrate all three source patterns:

1. authored seed;
2. simulation-emergent recognition;
3. query-driven local generation proposal.

The implementation does not need a real planner model call. Deterministic fixtures/proposals are preferred for this issue.

### Perspective integration

Use the existing context/knowledge contracts rather than adding a new visibility system.

A hook may be considered ready only after:

- its required persistent details are committed; and
- the intended perspective could receive the grounded information through existing retrieval/context rules.

### No quest engine

Do not add:

- quest completion state;
- objective checklists;
- special quest timers;
- required routes/solutions;
- automatic failure because a player ignored a hook;
- a canonical situations table.

## Verification Fixture: Brownbag Groceries

Use one local world state to prove three kinds of playable material.

### Shared established state

At minimum:

- Brownbag Groceries exists;
- it is a functioning grocery store with aging equipment;
- several employees/NPCs exist with ordinary goals/relationships;
- the owner is under some financial pressure;
- Awakening Earth supernatural activity exists in the surrounding region.

### Social situation

Provisional idea:

> An employee is considering quitting because conflict with a manager is worsening.

Prove:

- the candidate can be recognized from actor goals/relationships plus optional provisional detail;
- the player cannot retrieve the provisional intention before it is committed;
- if the NPC is going to act on the intention or tell the player, the relevant goal/intention is committed first;
- a conversational hook can then expose only what that NPC plausibly knows.

### Environmental/economic situation

Provisional idea:

> One aging freezer is close to failure.

Prove:

- the store may begin only with coarse aging-equipment truth;
- a specific freezer/condition may be generated later without retconning that truth;
- the failure detail is committed before the player observes evidence or simulation spoils inventory;
- ignoring the visible problem does not invoke a quest-failure path; ordinary process/state consequences determine what follows.

### Supernatural situation

Provisional idea:

> A customer repeatedly buying large quantities of salt is responding to an unrevealed supernatural problem.

Prove:

- the customer's behavior may be observable while the reason remains hidden;
- the reason cannot leak through player perspective;
- if an NPC knows a rumor, represent that as belief/knowledge rather than universal truth;
- additional supernatural facts are committed only as needed;
- a later direct confrontation, if one develops, remains subject to #35 rather than being balanced by this content system.

## Acceptance Criteria

- [x] game-agnostic schemas/contracts exist for grounded non-authoritative situation candidates, provisional details, discovery affordances, and commitment evidence
- [x] these planning/content objects are not stored as canonical World State merely because they were proposed
- [x] deterministic validation rejects a hook that depends on still-provisional persistent detail
- [x] committed details point to ordinary authoritative records rather than a parallel truth store
- [x] existing no-retcon behavior prevents changing a committed detail while still allowing unrelated undefined detail to be densified
- [x] perspective-aware surfacing uses existing knowledge/context boundaries and does not leak hidden or provisional information
- [x] an NPC cannot causally act from a provisional hidden detail; the required fact/goal/belief/social state is committed first
- [x] false or uncertain NPC claims can be represented canonically as beliefs/testimony without converting the proposition into world truth
- [x] authored-seed, simulation-emergent, and query-driven-local-generation patterns are demonstrated
- [x] ignoring a hook causes no special quest-state mutation or automatic failure
- [x] engagement/failure produces ordinary authoritative state/events through existing execution/simulation boundaries
- [x] the Brownbag fixture demonstrates social, environmental/economic, and supernatural situations from one shared world state
- [x] automated tests prove provisional -> committed -> no-retcon behavior
- [x] architecture tests continue to enforce engine/reference-game separation
- [x] `npm run check` passes

## Implemented Seam

- `packages/engine/src/content-planning.ts` owns the game-agnostic Zod contracts, authoritative-grounding catalog, commitment checks, readiness assessment, and opaque perspective-safe handoff.
- `packages/reference-game/src/content-situations.ts` derives all three Brownbag situation patterns from the shared reference world and proposes canonicalization through existing mutations and densification rules.
- `packages/reference-game/test/content-situations.test.ts` proves provisional-to-committed behavior, perspective boundaries, no-retcon enforcement, ordinary consequences, and the absence of quest/situation persistence.
- `tests/content-planning.test.ts` verifies the generic engine boundary and confirms that content-planning material is rejected by the canonical World State schema.

## Non-Goals

- implementing campaign-plan persistence, horizon prioritization, or replanning (#28)
- implementing NPC conversation orchestration (#14)
- implementing the first complete playable loop (#19)
- writing all first-region situations
- creating a quest database or quest-log UI
- making every interesting possibility canonical
- continuously simulating every possible situation
- challenge balancing already owned by #35
- changing the authority model established by #5–#13 and #17
