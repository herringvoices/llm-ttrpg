# Awakening Earth: Starting Region Generation & Local World Seeding

**Status:** Settled and implemented by Issue #17 - Starting Region Generation & Local World Seeding
**Scope:** New-game setup, generated campaign seeding, local-world detail levels, validation, lazy densification, geographic grounding, NPC instantiation, and generation diagnostics for the Awakening Earth reference game.

## Implemented seam

The reference game now supplies a staged, bounded-repair starting-region generator that compiles validated linked region, settlement, institution, locality, player, NPC, pressure, creature, knowledge, process, and opening-situation records into an ordinary campaign package. Generation retains normalized constraints, accepted stage outputs, attempt diagnostics, audit findings, and provenance. A deterministic fixture verifies authoritative initialization, three-scope lazy catch-up, material follow-up questions, retry ceilings, no-retcon densification, and ephemeral-person promotion.

## Goal

A player may begin almost anywhere that fits the setting without choosing from a small list of hand-authored towns.

The player can provide very little:

> "Medium-sized city in the Pacific Northwest."

or much more:

> "Small Southern town, isolated but not economically dying. I live near the edge of town and work remotely."

The game interprets those preferences, generates a coherent campaign seed under Awakening Earth constraints, validates it, and initializes authoritative World State.

The result should feel locally specific without requiring the project to pre-author or pre-simulate an entire city, county, or country.

## Core Principles

### Generate once, then treat it as real

Generated campaign content is not soft improvisation.

Once generated content passes validation and enters authoritative campaign/world state:

- established places exist;
- established people exist;
- established relationships and institutions exist;
- established facts may not be silently rewritten because a later generation pass prefers a different answer;
- future changes occur through simulation, authored events, or explicit state mutation.

### Coarse truth exists to constrain later detail

High-level generation should not merely summarize a place.

It should establish enough truth that later model calls know:

- what already exists;
- what must remain consistent;
- what questions are still unanswered;
- what kinds of detail can safely be generated later;
- what setting and local constraints must shape that detail.

### Generate the smallest causal local system that supports play

Do not generate an encyclopedia.

Do not generate arbitrary content quotas such as twelve NPCs, eight locations, and three quests.

Generate enough structured world to make the player's immediate life coherent, plus enough coarse surrounding truth to constrain future generation.

## Setup Input Contract

### Freeform first, structured underneath

The player-facing setup may be natural language.

Examples:

- "Small town somewhere in the Midwest."
- "A medium city in the Pacific Northwest."
- "Rural, mountainous, and kind of isolated."
- "Surprise me."

The setup interpreter normalizes that input into structured constraints such as:

- settlement scale or density;
- broad geographic region;
- climate/environment;
- remoteness/connectivity;
- economic character;
- desired social context;
- any explicitly requested features;
- any explicitly rejected features.

The structured representation is an engine/application contract. The player does not need to complete a form unless a future UI chooses to expose those controls.

### Explicit player statements are constraints

Player-established setup details are authoritative constraints unless they contradict each other or violate the selected game package.

Unspecified details belong to the generator.

If the player says the town is isolated, generation may not quietly make it a suburb of a major city because that would simplify institutional generation.

### Ask only consequential follow-ups

The game should not interrogate the player about every unspecified dimension.

A follow-up question is appropriate only when the missing answer would materially change what kind of starting world should be generated or when explicit player constraints conflict.

Otherwise, the generator chooses a plausible answer.

### No mandatory approval loop

A concise generated setup summary may be shown before play, and the player may regenerate before beginning if they dislike it.

A mandatory confirm-every-detail step is not part of the default flow.

## Campaign Seed Model

The generated seed should be represented as linked campaign/content records rather than one deeply nested "town object."

The same general schema supports a rural town, suburb, major city neighborhood, or other starting context.

### Regional frame

Coarse facts that constrain future generation:

- broad geographic placement;
- climate and terrain;
- surrounding settlement pattern;
- transportation connectivity;
- broad economic context;
- supernatural pressure baseline;
- Gate frequency/history at the regional level;
- nearest larger population centers;
- other region-scale constraints that materially affect local life.

The regional frame is not deeply simulated.

### Primary settlement

More concrete settlement truth:

- name;
- approximate population;
- settlement type / urban form;
- broad economy;
- districts or neighborhoods at coarse resolution;
- transportation relationships;
- local monster/Gate history;
- broad institutional capacity;
- culturally or economically meaningful local traits.

A city may contain hundreds of thousands of fictional residents without those residents becoming individual records.

### Detailed starting locality

The area immediately relevant to the player's life receives the most detail.

Examples may include:

- player home;
- immediate neighborhood;
- workplace or school when relevant;
- ordinary destinations the player plausibly uses;
- nearby public institutions;
- relevant supernatural-response locations;
- enough streets/routes/transit relationships to support movement and discovery.

This is the initially inspectable local map, not the entire settlement.

### Institutions

Locally relevant institutions should have enough structure to participate in simulation.

Useful fields/concepts include:

- institution type;
- service area or jurisdiction;
- goals;
- capabilities;
- resources;
- constraints;
- important relationships;
- current pressures;
- coarse state;
- expansion/detail hooks for later queries.

Awakening Earth institutional defaults come from the setting package. The campaign generator decides their concrete local manifestations.

### NPC network

Only people whose individual identity currently matters should be instantiated.

Persistent NPCs may exist because they have one or more of:

- an ongoing relationship with the player;
- an institutional role likely to recur;
- an active goal;
- involvement in a pressure or process;
- relevant knowledge;
- an ongoing obligation or conflict;
- a distinctive capability/resource;
- meaningful repeated-interaction potential;
- responsibility for mutable world state.

Each initially persistent NPC should have a clear simulation reason to exist.

### Pressures

Pressures are first-class campaign state, not quests.

Examples:

- county response unit understaffed;
- local rents rising;
- a Gate discovered on private land;
- hospital cleansing supplies running low;
- a relationship deteriorating;
- monster activity increasing along a river corridor;
- a major firm considering leaving the region.

A pressure should identify:

- current state;
- relevant actors/institutions;
- cause or context;
- likely trajectory if ignored;
- conditions or events that may change it;
- relevant simulation scope.

Starting pressures should include a mix of ordinary, social/institutional, and supernatural concerns. They should not all exist to entertain the player.

### Knowledge distribution

The seed should intentionally distinguish:

- public/common knowledge;
- player knowledge;
- actor/group-specific knowledge;
- rumors;
- false or incomplete beliefs;
- hidden canonical truth.

Generation must use the engine's existing fact/belief boundaries rather than making all actors share the same information.

### Active processes

A pressure is a state or tension. A process describes change over fictional time.

Examples:

- staffing continues worsening unless recruitment improves;
- monster pressure grows in an unmanaged area;
- a relationship cools as missed obligations accumulate;
- an institution consumes a scarce resource;
- an active Gate destabilizes over time if the setting/campaign establishes that behavior.

The starting seed should contain several processes capable of producing off-screen change through the generic lazy-world-simulation contract.

### Player context

The seed should establish enough ordinary context to begin play:

- home;
- immediate relationships;
- ordinary-life situation;
- starting access to locations and institutions;
- relevant routines;
- current obligations;
- opportunities and pressures without forcing a required route.

## Detail Resolution

Generated content may exist at different resolutions.

### Fully instantiated

The record is authoritative and detailed enough for immediate simulation or interaction.

### Established but coarse

The fact/entity is authoritative, but many internals are intentionally unspecified.

Example:

> Harrow Creek has a 43-bed hospital with limited magical-care capability.

The hospital exists. Its exact staff roster, floor plan, and pharmacy inventory do not need to exist yet.

### Unestablished

The surrounding world provides enough constraints to generate the detail later, but the detail itself is not yet canonical.

Example:

> A smaller town lies about thirty miles east along the highway.

Its exact name or mayor may remain unestablished until relevant.

### Initial depth heuristic: one ordinary week

The detailed starting bubble should be large enough to support roughly one ordinary week of plausible player life if no major supernatural event occurs.

Ask:

> What people, places, routines, and institutions would this character reasonably encounter during an ordinary week?

Generate those persistent details, then add supernatural systems that can plausibly intrude on that life.

This is a heuristic, not a fixed NPC/location quota.

## Generation Pipeline

Generation is staged so failures can be repaired locally rather than regenerating the entire campaign.

Recommended stages:

1. interpret and normalize player setup constraints;
2. generate regional frame;
3. generate primary settlement;
4. derive local institutions from setting + settlement constraints;
5. generate player context and detailed starting locality;
6. generate the persistent NPC network;
7. generate pressures, knowledge distribution, and active processes;
8. run coherence audit;
9. commit the validated seed through the existing campaign/world initialization boundary.

Later stages receive accepted outputs from earlier stages as constraints.

## Validation Contract

The LLM proposes content. It does not decide whether its proposal is valid.

### Deterministic hard validation

Hard validation should reject structural or canonical errors such as:

- malformed schemas;
- duplicate IDs;
- references to missing entities/scopes;
- invalid relationships;
- disconnected required location graph;
- generated content contradicting player-established constraints;
- generated content contradicting canonical setting truth;
- public content leaking hidden setting truth;
- impossible component/version references;
- a Gold awakener in the first playable era;
- a Gate redefined as alien machinery;
- active processes referencing nonexistent scopes;
- generated campaign content bypassing normal authoritative-state initialization.

These failures do not become world truth.

### Coherence audit

Some bad worlds are schema-valid.

A constrained model audit should review questions such as:

- Does institutional capacity plausibly follow from settlement scale, wealth, geography, connectivity, and nearby support?
- Are generated institutions internally consistent with their resources and constraints?
- Does the player's ordinary starting life have enough people/places/relationships to make sense?
- Are supernatural frequency and response capacity consistent with setting baselines or an explicit local reason for deviation?
- Do pressures have actors, causes, and trajectories rather than existing only as adventure hooks?
- Is the initial cast unnecessarily large?
- Are there semantic contradictions that deterministic validation cannot detect?

The audit returns structured issues rather than rewriting the seed directly.

### Repair locally

Repair the smallest invalid stage/subtree possible.

If healthcare capacity is implausible, repair healthcare/institution generation.

Do not regenerate the region, player family, workplace, and NPC network unnecessarily.

### Retry ceiling

Each generation stage receives:

1. initial generation;
2. targeted repair after validation/audit failure;
3. one final targeted repair.

If hard requirements still cannot be satisfied, setup fails with diagnostics rather than silently accepting invalid world state or looping indefinitely.

## Lazy Densification

Densification is **query-driven**, not simply "the player crossed into a new district."

Generate more detail when the current action/query requires finer facts than the authoritative world currently contains.

Example:

1. Coarse truth establishes that downtown contains mixed retail, apartments, and municipal buildings.
2. The player asks to find somewhere cheap to eat downtown.
3. Existing district constraints are retrieved.
4. Only the necessary restaurant/business details are generated and validated.
5. Those establishments become authoritative.
6. Entering one establishment may then require finer interior/staff/participant detail.

### Constraint envelope

Coarse records should provide enough data to constrain future expansion.

A coarse hospital record may establish:

- service area;
- capacity tier;
- magical medicine capability;
- staffing pressure;
- relationship to larger regional facilities.

Later generation can answer "does this hospital have a magical oncologist?" without reinventing what kind of hospital it is.

### Densification cannot retcon coarse truth

New specificity may not change the semantic meaning of established facts.

"Limited emergency medical capacity" cannot later densify into a world-class trauma center unless fictional events changed the hospital after the original fact.

"No permanent major-firm office" may densify into a regional firm that serves the town remotely. It may not become a local twelve-story headquarters.

### Bottom-up refinement

Newly instantiated detail may refine aggregate/coarse state when appropriate.

Top-down constraints limit detail generation.

Accumulated detail may support derived summaries upward.

This is refinement, not silent rewriting.

## Real-World Geographic Grounding

Use real geography as a scaffold, not as a requirement to reproduce the real world.

### Default: fictional locality inside a real region

Example:

> "Medium-sized city in the Pacific Northwest."

The game may generate a fictional city in a plausible real regional context.

### Fictional locality relative to a real place

Example:

> "Small town about an hour outside Seattle."

The game may generate a fictional settlement with plausible regional/geographic relationships without requiring exact live map data.

### Explicit real locality

Example:

> "I want to live in Chicago."

Chicago remains Chicago at coarse geographic scale.

Real major geography and well-established regional structure constrain generation.

Fine player-relevant campaign details may still be fictional unless an explicit real-world data source is available and selected.

Examples of acceptable generated local fiction inside a real city:

- apartment building;
- employer;
- local responder office;
- small business;
- NPC network;
- supernatural incidents.

The runtime should preserve provenance so generated campaign fiction is not confused with a real-world anchor.

### Geographic authority order

When facts conflict, authority is:

1. explicit player-established geography;
2. trusted real-world coarse anchors available to the game;
3. already-persisted generated campaign facts;
4. new generation.

New generation cannot override a higher-authority established fact.

### No full real-world database requirement

The game does not need perfect geographic coverage.

If the player travels far beyond the currently detailed region, generation can establish a new relevant destination under coarse real-world constraints and existing campaign truth.

Real geography constrains generated fiction. It does not require pre-modeling reality.

## Population and NPC Resolution

A large fictional population can exist statistically without individual records.

### Statistical population

Aggregate demographic/economic/population truth.

### Ephemeral scene person

A person needed for a momentary scene but not yet worth persistent simulation.

Examples:

- customer in work clothes;
- older couple;
- teenager studying.

### Identified person

Identity is established and persistent enough not to be contradicted, but simulation detail may remain coarse.

Example:

> Mayor Danielle Price.

### Persistent simulation actor

The person has enough ongoing goals, relationships, knowledge, resources, obligations, or state to participate in simulation.

### Promotion

A person may be promoted to a higher resolution when interaction makes persistence valuable.

If the player repeatedly speaks with "the teenager studying," later densification may establish a persistent identity and life consistent with everything already observed.

Promotion adds specificity. It may not contradict established traits.

### Cast minimization

The initial generator should produce the smallest cast that makes starting relationships, institutions, pressures, and processes causally coherent.

The coherence auditor should flag NPCs that can be removed without affecting any meaningful starting system.

## Mechanical Realization Boundary

World/population detail and rules-mechanical detail are separate axes.

The population ladder above answers how much **individual identity and simulation state** exists. It does not imply that every identified or persistent person has a complete character sheet.

Issue #34 defines the independent mechanical-realization ladder:

- unrealized;
- constrained;
- partial;
- complete.

Region generation may establish mechanically meaningful constraints without choosing exact rules values, including:

- occupation/training/history;
- mundane or awakened status;
- species/origin;
- size/morphology;
- observed capabilities;
- supernatural traits;
- survival/growth history.

Those constraints become authoritative inputs to later mechanical densification.

A persistent NPC may therefore begin play with detailed relationships, beliefs, goals, and obligations but only constrained mechanical state.

Likewise, a concrete monster instance may be established by origin, morphology, behavior, location, observed effects, and campaign role before exact encounter mechanics are needed.

Mechanical realization may add specificity later but may not contradict the region seed or subsequent authoritative observations.

## Generation Provenance and Diagnostics

Generation should retain enough non-player-facing metadata to explain how important world facts were established.

Useful provenance classes include:

- player-established;
- real-world-anchor;
- setting-derived;
- generator-chosen;
- simulation-derived;
- later-densification.

Where useful, records may also retain source IDs or derivation references.

Example diagnostic:

> Local public monster response is limited because the settlement is small, remote, modest in tax base, far from a regional center, and facing above-baseline supernatural pressure.

The player normally receives only the fictional result.

Diagnostics exist for development, testing, orchestration, and causal inspection.

## Reproducibility

### Generation provenance

Record enough information to reproduce and diagnose a generation attempt:

- generator/orchestrator version;
- game component versions;
- generation seed/control seed where applicable;
- raw player setup input;
- normalized constraints;
- stage outputs;
- validation results;
- audit findings;
- repair history.

LLM output itself is not assumed to be perfectly deterministic from a numeric seed alone.

### Resumable desktop generation

The desktop persists an in-progress campaign-generation draft before the first model call and
checkpoints it after every accepted stage. The draft retains the stable campaign identity and
control seed, normalized request, accepted stage outputs, diagnostics, outstanding follow-up
questions, completed audit result, and completed opening-incident proposal. A model failure,
process exit, or application upgrade therefore resumes at the first unfinished stage instead of
regenerating accepted material. Follow-up questions are a durable pause in the same workflow;
answering them invalidates normalization and its downstream stages because the authoritative
setup input changed. The draft is removed only after the playable world and its initial campaign
plan have been persisted successfully.

Every starting-region model attempt has a twenty-minute wall-clock ceiling. The comparatively
large player-context stage asks the model only for concise identity/local-life context, grounded
skill signals, and evidenced departures from baseline Attributes. The engine deterministically
derives initial goals from normalized player wants and fills social-state boilerplate, repetitive
mundane mechanics, complete baseline Attribute evidence, empty stress/status state, and Level 0
progression. Player-context does not launch an automatic model repair
after an invalid response; it fails back to the saved draft so one bad response cannot silently
consume another full attempt.

The player-context model proposal is intentionally permissive at the transport boundary. The
engine normalizes optional lists, filters unknown references/evidence, clamps skill values,
deduplicates skills, and supplies an evidence-backed fallback skill before constructing and
validating the authoritative `PlayerContextSeed`. A compact proposal must never be passed directly
to the expanded-state validator: transport-shape errors are reported or normalized at the compact
boundary rather than misreported as missing expanded fields.

NPC generation uses the same compact-boundary pattern. The model proposes only a small cast's
identity, narrative relevance, goals, relationship signals, salient memories, and genuinely
mechanical constraints. The engine assigns stable IDs and deterministically constructs the
persisted entity, actor-social-state, timestamps, constraint ownership, and provenance records.
NPC generation receives only the accepted locality, institutions, normalized player material, and
the concise player context it needs; it does not re-serialize the full accumulated working state.
This stage has a bounded 1,536-token response and no automatic second model pass. A timeout or bad
proposal therefore returns to the durable checkpoint at the NPC step instead of spending another
long attempt or discarding the already accepted world.

Draft resume includes a narrowly scoped compatibility normalization for early generated drafts
whose pressure/process `scopeId` values used the generation schema identifiers
(`starting-region.region.v1`, `starting-region.settlement.v1`, or
`starting-region.locality.v1`). Those known legacy values are replaced with the corresponding
accepted `scope.<generated-entity-id>` references before auditing and final validation. Arbitrary
unknown scope references still fail validation rather than being silently repaired.

Pressure generation also crosses a compact model boundary. The model chooses the three required
pressure categories, their developing situations, a small creature set, readable supernatural
capabilities/tells/counterplay, and any useful initial beliefs. The engine assigns stable IDs,
filters actor references, derives canonical pressure facts and active processes, supplies bounded
numeric threat dimensions, and validates the authoritative linked records. It does not ask the
model to serialize provenance, process boilerplate, or repetitive persistence structures.
The compact pressure response is likewise capped at 1,536 tokens and does not automatically run a
second full model attempt.

The opening-situation stage receives a deliberately reduced view of accepted people, places,
institutions, pressures, and creature cues rather than the complete accumulated generation state.
Its output is a short non-authoritative opening brief capped at 1,024 tokens. The subsequent
coherence audit similarly omits mundane mechanics and other irrelevant boilerplate, returns at
most five material issues, and is capped at 1,024 tokens. These reductions preserve the design
checks while avoiding minutes of prompt processing and unbounded verbose structured output.

The model coherence audit is advisory. It may record warnings, but it cannot make a generated
world invalid or autonomously rewrite an accepted stage; deterministic schemas and reference
validation own that decision. Missing echoes of appearance, hobbies, online activity, or other
biography color are not structural defects. Before the audit, a deterministic minimal-grounding
pass may add a single linked location for an explicit physical workplace that the accepted
locality omitted, and add that location to the player's routine and access lists. It does not
invent a wider subculture, supporting cast, or institution merely to mirror every biography fact.

### Deterministic reference campaign

Maintain one known-valid reference campaign fixture for deterministic integration tests.

It exists to test:

- schemas;
- campaign initialization;
- adapter integration;
- lazy densification boundaries;
- NPC promotion;
- institution/state behavior;
- lazy simulation;
- context retrieval.

It is not the only player starting region.

### Generated-world tests use invariants

Procedural generation tests should generally assert constraints rather than exact arbitrary names/content.

For a generated medium Pacific Northwest city, useful assertions include:

- valid regional frame exists;
- settlement scale is internally plausible;
- institutions derive coherently from settlement constraints;
- detailed starting locality is connected;
- no canonical setting contradiction exists;
- no Gold awakeners exist;
- required NPC relationships are valid;
- pressures/processes reference valid actors/scopes;
- generation provenance is present.

## Framework Boundary

Starting-region generation creates **campaign/content**, not setting truth and not generic engine lore.

The generic engine may own reusable generation orchestration, validation hooks, persistence boundaries, provenance envelopes, and model-request plumbing.

Awakening Earth owns:

- setting constraints;
- societal defaults;
- supernatural ontology;
- Gate/monster assumptions;
- first-game generation guidance.

The campaign layer owns the generated concrete region.

The pair-specific adapter owns mechanical mappings when generated content invokes Awakening Earth concepts through the selected ruleset.

Once committed, generated campaign content enters authoritative World State through the same boundary as hand-authored campaign content.

## Dependencies

Canonical inputs:

- [Awakening Earth: Setting & World Premise](setting-premise.md)
- [Awakening Earth: Institutions, Economy & Society](institutions-economy-society.md)
- Game Package Contracts & Content Model (#27)
- Lazy World Simulation & Catch-Up (#12)

Generation must also consume the settled outputs of:

- Player Fantasy & Starting Situation (#25)
- Content & Encounter Principles (#26)

Reference Game Rules & World Model Integration (#18) consumes this design.

## Verification Scenarios

### Minimal setup

1. Player supplies: "Medium-sized city in the Pacific Northwest."
2. Setup normalizes constraints without unnecessary follow-up questions.
3. Generation produces a regional frame, settlement, local institutions, detailed starting locality, necessary NPC network, pressures, knowledge distribution, and active processes.
4. Hard validation passes.
5. Coherence audit passes or triggers only localized repair.
6. The validated seed initializes authoritative World State.

### Persistence

1. Re-query established setting/campaign facts later.
2. Verify they remain stable unless changed through ordinary simulation/state mutation.

### Lazy densification

1. Player asks for something in a coarse district that lacks specific businesses.
2. Existing region/settlement/district truth constrains generation.
3. Only required missing details are generated.
4. New content validates, persists, and does not contradict prior truth.

### NPC promotion

1. An ephemeral scene person is described coarsely.
2. The player meaningfully engages them.
3. The person is promoted to an identified/persistent actor.
4. New details remain consistent with prior observations.

### Real-world anchor

1. Player explicitly chooses a real city.
2. Coarse real geography is preserved.
3. Fine fictional campaign details are generated without claiming to be real-world records.
4. Provenance distinguishes real anchors from generated campaign content.

### Reproducible fixture

1. Load the project's fixed reference campaign.
2. Verify identical initial authoritative content for integration tests.
3. Separately test procedural generators through invariants rather than exact arbitrary names.
