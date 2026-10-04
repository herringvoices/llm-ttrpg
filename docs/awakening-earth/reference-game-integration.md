# Awakening Earth Reference Game Integration

**Status:** Settled and implemented by Issue #18 — Reference Game Rules & World Model Integration
**Scope:** The first complete Awakening Earth integration slice: generated opening-incident realization, magical interaction, first-power execution, Gate representation, minimal institutional response, creature realization, and end-to-end persistence through the existing engine boundaries.

## Goal

Issue #18 is the integration bridge between already-settled systems.

It does not redesign the ruleset, setting, starting-region generator, character creation, content principles, NPC model, monster design, or generic engine.

It proves that an LLM-generated Awakening Earth situation can become a real playable incident through validated package-specific rules and ordinary authoritative state.

The target flow is:

> **generated local world -> generated opening brief -> structured incident realization -> commitment -> player action -> Awakening Earth adapter -> reference rules -> authoritative consequences -> institutional/world response -> later context/catch-up**

## Inputs Already Settled

#18 consumes the implemented outputs of:

- #6 World State, Fictional Time & Event History
- #8 Checks, Resolution & RNG
- #9 Hierarchical Tool Catalog
- #10 Context Assembly & Knowledge Retrieval
- #11 Player Action Execution Pipeline
- #12 Lazy World Simulation & Catch-Up
- #13 NPC State, Knowledge, Goals & Relationships
- #17 Starting Region Generation & Local World Seeding
- #21 Core Game Rules & Resolution Model
- #22 Character Progression & Abilities
- #23 Setting & World Premise
- #24 Institutions, Economy & Society
- #25 Player Fantasy & Starting Situation
- #26 Content & Encounter Principles
- #27 Game Package Contracts & Content Model
- #34 Character & Creature Mechanical Generation
- #35 Monster Design, Threat Calibration & Encounter Composition

#18 should integrate those contracts rather than invent replacements.

## Vertical Slice

The deterministic reference fixture uses an ordinary local setting such as Brownbag Groceries because that location already exercises generated/local content and #26 situation material.

**The incident itself must not be hard-coded into the game architecture.**

The production path must be able to generate an opening incident from:

- the generated starting region;
- the player's established ordinary life;
- the generated `OpeningSituation` brief;
- relevant local pressures/processes;
- the player's power preferences/first-power proposal;
- Awakening Earth setting constraints;
- #26 grounding and commitment rules;
- #35 threat-envelope/challenge constraints when a player-facing creature is generated.

The automated verification path may use a deterministic scripted model response so exact behavior is reproducible. The same structured proposal schema and realization code must be used by the real local-model path.

The test fixture may consistently generate a known small supernatural incident, but no engine/reference-game branch may depend on that specific incident, creature, or location name.

## Opening Situation Brief vs Canonical Incident

#17 currently generates an `OpeningSituation` containing an awakening-event description, manifestation opportunity, unresolved consequences, and multiple actionable directions.

For #18, that object is a **generation/design brief**, not proof that the future incident has already happened.

The implementation must ensure that:

- an opening brief may guide realization;
- the brief itself does not create a canonical event;
- future details mentioned only as possibilities are not retrievable as player/NPC world truth;
- concrete entities, facts, creature instances, hazards, relationships, and events are committed only through validated realization;
- narration cannot convert the brief into truth merely by describing it.

If necessary, stop copying the opening brief into ordinary player-entity canonical data. Retaining it in setup/generation metadata is sufficient. The exact migration may vary, but protected planning/setup material must not masquerade as already-happened World State.

## Situation Realization

Add a reference-game integration seam that turns a grounded opening/situation brief into structured proposed incident content.

Exact TypeScript names may vary, but the proposal must be schema-validated and capable of representing the first slice's required additions, including as applicable:

- incident/local pressure identity;
- involved existing entity/location IDs;
- new entities/facts that must become canonical;
- creature concept/archetype/instance proposal;
- threat envelope when the creature is deliberately near-term player-facing;
- mechanical constraints required for later #34 realization;
- perspective/knowledge facts and beliefs;
- event or process seeds;
- institutional-response relevance;
- commitment/provenance links back to the grounding that allowed each new detail.

The model proposes. Deterministic validators decide whether the proposal may be committed.

### Realization pipeline

1. assemble authorized setting/local/player/content context;
2. request a structured incident proposal through the existing model runtime;
3. validate schema and references;
4. validate against established setting/campaign truth;
5. validate #26 grounding/commitment boundaries;
6. validate generated creature content against #35 requirements when applicable;
7. reject retcons against existing generated/coarse truth;
8. commit only the minimum required authoritative details;
9. densify mechanics through #34 only when an actual rules interaction requires them;
10. expose the committed scene/hook through ordinary perspective-aware context.

A failed proposal must not partially mutate state.

The implementation may use bounded repair consistent with existing generation conventions, but it must not silently accept invalid content.

## Magical Interaction

Awakening Earth establishes a qualitative rule:

> **Magic resists the mundane. Magic can meaningfully interact with magic.**

The first-slice adapter realization is intentionally **not** a small numeric bonus or percentage penalty.

### Interaction classes

The pair-specific Awakening Earth adapter must distinguish at least:

- **mundane source**
- **intrinsically magical source**
- **awakened direct-contact source**
- **magical item/material source**
- **explicitly sustained ranged magical source**

It must also distinguish the intended effect at least enough to separate:

- **direct material/bodily harm to magical structure**
- **displacement/movement**
- **restraint/containment**
- **environmental or indirect consequences**
- **other setting-valid interactions**

These classifications are setting/adapter concepts, not generic engine enums unless a genuinely reusable abstraction is already present.

### Mundane direct injury is qualitatively blocked

Against an intrinsically magical creature/material/effect, **ordinary mundane force cannot directly damage or penetrate the magical structure in the first slice**.

This should normally produce an `impossible` feasibility path for the attempted direct material/bodily harm rather than pretending the target merely has a +40% Resistance bonus.

Required reference behavior:

- ordinary handgun bullet -> weakest magical monster's body: no bodily Injury; bullet may visibly deflect/bounce depending on narration;
- ordinary rifle bullet -> same: no bodily Injury in this first-slice rule;
- ordinary mundane knife attempting to cut magical tissue: no cut;
- ordinary mundane strike attempting direct tissue injury: no Injury.

The rules result should still preserve ordinary consequences of making the attempt when appropriate.

This first-slice rule deliberately does not settle every catastrophic-scale edge case. Future explicit exceptions may be added through setting/adapter mechanics rather than weakening the baseline.

### Mundane physics still matters

Magical resistance is not blanket immunity to the ordinary world.

A mundane source may still interact through a different intended effect when fiction supports it:

- a vehicle may knock a creature aside even if the impact cannot directly injure its magical tissue;
- rubble may trap or obstruct it;
- a mundane barrier/net/restraint may matter if its ordinary strength is sufficient for containment;
- suffocation, environmental isolation, loss of footing, burial, or similar consequences remain possible when the creature's established biology/abilities allow them.

Each effect is resolved against the Resistance/feasibility appropriate to that effect.

Do not infer "cannot be injured by mundane force" as "immune to momentum, space, gravity, or environment."

## Awakened Direct-Contact Empowerment

An awakened person naturally counts as a magical source through:

- their own body;
- an ordinary object they are directly and intentionally wielding/contacting as part of the action.

Examples:

- awakened punch against a monster -> magical interaction;
- awakened person striking with an ordinary bat -> magical interaction;
- awakened person cutting with an ordinary knife they are holding -> magical interaction;
- awakened person pushing with a directly controlled shopping cart -> magical interaction for the contact while held.

This is ambient setting interaction, not a separate power and not a permanent enchantment.

Validation must establish that the actor is awakened and that the direct-contact/wielding relationship exists for the attempted action before the adapter classifies the source as magically valid.

## Projectile Dissipation

Ordinary ambient empowerment does not persist long enough after separation to make normal mundane ranged attacks magical.

Therefore:

- an ordinary fired bullet from an awakened shooter is mundane at ordinary ranged impact;
- an ordinary thrown object is mundane after separation for its ordinary ranged impact;
- ordinary ammunition is not permanently enchanted by having been touched;
- a magical projectile, magical ammunition, magical ranged weapon/effect, or explicit ability that sustains empowerment at range remains magical according to its own rules.

Do not implement a generic millisecond decay timer in this slice. The first-slice classification is contact-bound unless an explicit sustained-ranged mechanic says otherwise.

## Reference Power

The deterministic integration fixture uses **Invincible** as its known first power because #22 fully specifies it.

At Level 1 / Power Level 1 / Manifestation Strength 1:

- passive Reinforced Body: +4 Durability and +2 Strength derived modifiers;
- active Invincible State:
  - activation: 0.25 seconds;
  - cost: 25 Mana;
  - duration: 2 seconds;
  - prevents new external physical bodily Injury Stress and tissue/bone/organ damage statuses;
  - does not prevent displacement, restraint, suffocation, non-Injury Stress, mind/social effects, or other non-injury consequences.

The fixture must use the ordinary first-awakening operation to manifest the power. It may not pre-author the player as already awakened.

Generated campaigns remain free to generate other valid first powers. The architecture must not depend on Invincible.

## Gate Representation

Gates remain **Awakening Earth content/world composition**, not engine concepts.

A concrete Gate should be representable using ordinary entities, locations, facts, routes/links, simulation scopes, and processes.

The first-slice Gate representation must be able to express:

- one Gate instance;
- an Earth-side entrance location;
- a pocket-environment interior represented as ordinary location/locality content;
- traversability while stable;
- current stability/state;
- relationship/link between entrance and interior;
- interior hazards, creatures, materials, and processes through ordinary campaign/world records;
- an exit/back-link when the Gate's established state permits one.

The generic engine must not gain `if gate` branches.

A Gate interior may have its own simulation scope when useful, but that uses the existing lazy-simulation machinery.

#18 only needs to prove this representation and one traversal/content fixture. The generated opening incident does not have to be a Gate incident.

## Minimal Institutional Response

Implement one concrete institutional process from #24: **public supernatural-incident response**.

The purpose is to prove that institutions change the world without waiting for the player.

The first-slice representation must support an authoritative incident/response state with enough information to model:

- location;
- reported/observed threat information;
- report time;
- responsible public-response institution/dispatch;
- response status;
- responder assignment or handoff;
- travel/response timing;
- completion/containment/handoff state.

Exact schema names may vary.

### Minimum lifecycle

At minimum, support a path equivalent to:

`reported -> dispatching -> responding/on-scene -> contained/resolved OR handed-off`

This is not a universal engine state machine. It is an Awakening Earth campaign/setting process.

Response timing and outcomes should derive from generated local institutional capacity and current state rather than a hard-coded global ETA.

The response must participate in lazy simulation. If the player leaves after an incident is reported and returns after meaningful fictional time, catch-up may advance the response without requiring the player's presence.

## Creature Realization

A generated player-facing creature begins from #17/#35 world constraints and may remain mechanically constrained until rules interaction demands exact mechanics.

Before the first mechanical confrontation:

- a canonical creature concept/instance exists;
- any required threat envelope already exists;
- #34 realization consumes those constraints;
- realization may add exact mechanics but may not secretly rescale the existing creature to today's party;
- the realized mechanics remain stable/no-retcon thereafter except through explicit growth/change operations.

The deterministic fixture should exercise at least one realization from constrained to sufficient mechanics for action resolution.

## Institutional and Social Consequences

The generated incident should permit multiple responses, not a mandatory fight.

At least one deterministic verification path must prove that consequences can affect more than the player/monster pair, for example:

- an NPC gains a memory/belief or relationship change;
- a public incident is reported;
- a local institution begins a response process;
- property/location state changes;
- a meaningful event is recorded;
- later context retrieves the result.

The incident may be ignored, fled from, reported, investigated, socially processed, or directly confronted as ordinary actions permit.

## End-to-End Verification Scenario

Use a deterministic scripted model proposal against the ordinary reference locality.

The exact proposal may vary, but the test must prove all of the following in one coherent flow:

1. a generated campaign/player starts mundane at Level 0;
2. #17's opening brief exists as generation/planning input rather than an already-happened event;
3. the structured model-runtime path proposes a grounded supernatural incident;
4. validation commits the minimum incident facts/entities without retcon;
5. any near-term creature receives a valid threat envelope before mechanical realization;
6. the player's first awakening is committed through the normal operation and manifests the fixture's Invincible power;
7. an ordinary mundane firearm or comparable projectile cannot directly injure even the weak magical creature;
8. the awakened player can directly harm/interact with it using their body or a directly wielded ordinary object because contact empowerment makes the source magical;
9. an ordinary projectile released by the awakened player is mundane again at normal ranged impact unless an explicit sustained-ranged mechanic applies;
10. Invincible prevents bodily Injury during its active window but does not block a non-injury consequence such as displacement/restraint;
11. creature mechanics are realized from prior canonical constraints rather than regenerated to fit the moment;
12. the incident can be reported to public response;
13. the player may leave;
14. fictional time advances and lazy catch-up progresses the response institution;
15. later context sees the committed incident, consequences, response state, and relevant perspective-specific knowledge;
16. save/reload preserves every authoritative consequence used by the verification;
17. narration may explain the results but cannot change any of them.

The fixture should be deterministic through scripted structured model output and seeded RNG. Production uses the local model runtime with the same schemas.

## Implementation Boundaries

### Generic engine

May provide only genuinely reusable validation/execution/persistence/model-runtime facilities already implied by existing contracts.

Do not add Awakening Earth concepts such as:

- magic-vs-mundane classification;
- Gates;
- awakening;
- monster response;
- Invincible;
- magical-contact empowerment.

### Reference ruleset

Owns:

- Performance/Resistance/Effect;
- feasibility and resolution;
- Stress/status mechanics;
- progression/power/Mana mechanics;
- the concrete Invincible operation/effects where those are rules-level.

### Awakening Earth setting

Owns:

- magic-resists-mundane truth;
- direct-contact ambient empowerment truth;
- projectile-dissipation truth;
- Gate ontology;
- public-response ecology;
- setting constraints used by generation.

### Awakening Earth adapter

Owns:

- mapping magical interaction into reference-rules feasibility/inputs;
- validation/provenance of magical source classification;
- setting-to-rules bindings for awakening/power-relevant concepts;
- any pair-specific translation needed for the first slice.

### Generated campaign/world

Owns:

- concrete locality;
- concrete incident;
- NPCs/institutions;
- Gate/creature instances when generated;
- mutable authoritative consequences after commitment.

### LLM

May:

- generate the incident proposal;
- interpret player intent;
- propose legal structured inputs;
- narrate committed results.

It may not invent mechanics, bypass validation, or mutate truth through prose.

## Acceptance Criteria

- [x] `OpeningSituation` is treated as a generation/design brief rather than an already-happened canonical event
- [x] the production integration can request a structured opening-incident proposal through the existing local-model runtime
- [x] tests can inject a deterministic scripted proposal through the same realization contract
- [x] invalid/retconning incident proposals commit no partial state
- [x] incident realization obeys #26 grounding and commitment boundaries
- [x] generated near-term creature content preserves #35 threat-envelope requirements
- [x] creature mechanics can densify through #34 only when required
- [x] first-power manifestation uses the existing authoritative awakening/progression operation
- [x] Invincible is executable with its settled Level-1 passive/active behavior in the deterministic fixture
- [x] mundane direct material/bodily harm against magical structure is classified impossible in the first slice rather than modeled as a small percentage penalty
- [x] a mundane firearm/projectile cannot directly injure the weakest magical reference creature
- [x] magical/direct-contact attacks use normal rules interaction rather than the mundane harm barrier
- [x] an awakened actor's directly wielded mundane object qualifies for magical interaction only while directly/contactually used
- [x] ordinary ambient empowerment does not make released mundane projectiles magical at normal ranged impact
- [x] non-injury mundane effects such as displacement/restraint/environmental consequences remain independently resolvable
- [x] magical-interaction provenance records the applicable Awakening Earth setting facts
- [x] Gate instances/interiors can be represented and traversed through ordinary content/location/simulation structures with no Gate-specific generic-engine branch
- [x] a minimal public supernatural-response process advances authoritative state over fictional time
- [x] lazy catch-up can advance that response while the player is absent
- [x] generated/local content references setting/rule definitions rather than hard-coded encounter branches
- [x] one deterministic vertical thread commits state/time/events/NPC-or-institution consequences atomically and later context retrieves them
- [x] save/reload preserves the integrated consequences
- [x] architecture boundary tests continue to keep Awakening Earth concepts out of the generic engine
- [x] `npm run check` passes

## Implemented Seam

- Generated opening situations remain protected generation metadata. A production model request and deterministic fixture share one Zod-validated incident proposal and realization path.
- Incident realization resolves authorized local references, verifies setting facts and grounding, preserves the committed threat envelope, rejects retcons atomically, and leaves exact creature mechanics constrained until rules interaction requires them.
- The Awakening Earth adapter classifies effect-specific magical interaction from committed world state plus immutable setting facts, including awakened body contact, directly wielded ordinary objects, and released-projectile dissipation. Applicable fact IDs remain in Resistance provenance.
- The reference ruleset implements Invincible's settled Level-1 passive bonuses and its timed, Mana-costed active protection without suppressing displacement or other non-injury consequences.
- Gates compose ordinary entities, locations, route facts, and lazy-simulation scopes. Generic route traversal follows canonical route facts and stores current position as mutable world truth.
- A campaign-owned public-response process advances reported incidents through dispatch, response, on-scene, and final disposition during ordinary lazy catch-up.
- `packages/reference-game/test/reference-game-integration.test.ts` exercises the complete deterministic thread, including context, event history, narration immutability, and SQLite save/reload.
- Issue #19 now consumes this seam through the desktop play-session controller and generated-package reconstruction path.

## Verification

- `npm run check`
- Deterministic integration coverage: `packages/reference-game/test/reference-game-integration.test.ts`
- Generic-engine boundary coverage: `tests/architecture-boundary.test.ts`

## Non-Goals

- a sophisticated campaign director beyond the implemented #28 seam
- broader NPC conversation behavior beyond the implemented #14 seam
- production visual polish beyond the implemented #19 text-first UI
- exhaustive magical-interaction edge cases at catastrophic mundane force
- a universal ranged-enchantment decay simulation
- every Gate type/interior rule
- full emergency-services simulation
- every institution from #24
- every possible generated first power
- writing a fixed canonical opening incident
- building a quest engine
