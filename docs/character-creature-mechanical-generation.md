# Character & Creature Mechanical Generation

**Status:** Canonical design source for Issue #34  
**Scope:** Mechanical realization levels, human/NPC character-sheet generation, monster/creature realization, demand-driven densification, no-retcon validation, provenance, and mechanics-inspection triggers.

## Purpose

The game must be able to run a large world without generating a complete mechanical sheet for every person and creature up front.

At the same time, any person or monster that becomes mechanically relevant must eventually have stable, rules-valid mechanics that remain consistent with everything already established in fiction and simulation.

Issue #34 defines that bridge.

## Separate world/social resolution from mechanical realization

These are independent axes.

### World/social resolution

Owned by #17 and #13:

1. statistical population;
2. ephemeral person;
3. identified person;
4. persistent simulation actor.

This answers:

> How much individual identity/social state do we persist?

### Mechanical realization

Owned by #34:

1. unrealized;
2. constrained;
3. partial;
4. complete.

This answers:

> How much exact rules state has been authoritatively instantiated?

A recurring NPC may be socially detailed but mechanically sparse.

A momentary threat may be mechanically detailed enough to resolve an encounter without becoming a rich social actor.

## Mechanical realization levels

### Unrealized

No rules profile has been generated because no mechanic currently requires one.

### Constrained

Canonical facts establish mechanically relevant bounds or requirements, but exact rules values remain unspecified.

Examples:

- "experienced ER nurse";
- "ordinary unawakened human";
- "professional kickboxer";
- "panther-sized quadrupedal magical creature";
- "demonstrated enough force to overturn a motorcycle."

### Partial

Only the mechanics required by current/anticipated operations have been instantiated.

Examples:

- Perception and one relevant skill for a surveillance check;
- Strength/Agility/Durability and one supernatural attack for an encounter;
- medical competency plus stress/status state for treatment.

Partial state is canonical and may never be regenerated inconsistently.

### Complete

The active ruleset/adapter has no missing required fields for the entity's currently supported mechanical model.

Complete does **not** mean listing every conceivable open-ended Skill or unknown future life fact.

For a reference-game human, complete normally means the full current actor/progression/power state required by supported mechanics.

For a monster, complete means the full supported creature profile. It need not mimic human progression fields that do not fictionally apply.

## Densification policy

Generate mechanics only when needed.

Triggers include:

- an operation requires missing rules data;
- a participant becomes mechanically important;
- an encounter requires creature mechanics;
- assistance/competition/treatment/investigation requires previously unrealized competency;
- a mechanics-inspection power needs a sheet;
- generated campaign content explicitly requests a mechanical anchor;
- a partial profile no longer satisfies relevant rules operations.

Prefer the smallest coherent expansion that satisfies the trigger.

Generate a complete profile when:

- the game effect explicitly reveals a full sheet;
- enough interacting mechanics are required that piecemeal generation would create inconsistency;
- the entity is expected to remain broadly mechanically relevant and complete realization is cheaper/safer than repeated fragments.

## Authority and no-retcon constraints

All later generation consumes established authoritative truth.

Hard constraints include:

- committed rules values;
- entity/fact data;
- setting/campaign traits;
- species/origin/age/size;
- occupation/training/history;
- authoritative observations/effects;
- prior mechanical outcomes that imply capability bounds;
- prior realization provenance.

Generation may fill unknowns but may not contradict them.

Beliefs, rumors, mistaken eyewitness accounts, and actor guesses are not true-generation constraints unless separately backed by canonical truth.

They remain constraints on what those actors believe.

## Package ownership

### Engine

The engine owns generic orchestration/validation/mutation/persistence boundaries only.

It does not contain human stat formulas, monster stat tables, challenge ratings, Powers, or creature taxonomies.

### Ruleset

The ruleset owns mechanical schemas, Attribute/Skill semantics, stress/status mechanics, resolution math, progression mechanics, and validation.

The selected reference rules already establish that every mechanically modeled actor uses the same 18 species-neutral Attributes.

### Setting

The setting owns fictional biology/ontology and world constraints.

For Awakening Earth this includes:

- transformed Earth organisms;
- spontaneously generated magical organisms;
- Gates and Gate-associated ecology;
- magical resistance;
- monster growth over survival time;
- death/disintegration/loot truths;
- human awakening/progression lore.

### Setting adapter

The adapter maps fictional concepts into the selected rules.

### Campaign/content

Campaign state owns each concrete person's/creature's identity, history, observations, local circumstances, and previously established traits.

## Reference-game human generation

Human mechanical generation works from evidence rather than arbitrary budgets.

Inputs may include:

- age/history;
- occupation;
- education/training;
- hobbies;
- demonstrated competencies;
- health/condition;
- supernatural status;
- existing character/progression state.

For mundane humans, generate Attributes/Skills using reference-rules baselines and the same evidence-first philosophy established for player creation in #25.

For awakened humans, complete realization may additionally include:

- Character XP/Level;
- advancement state;
- Mana;
- manifested Powers;
- PP/Power Level;
- Manifestation Strength;
- growth-profile data.

#25 remains authoritative for player-facing character-creation inputs and tuning. #34 supplies shared mechanical-realization machinery reusable by player and NPC generation.

## Reference-game monster generation

Monster generation must solve two problems:

1. What creature exists fictionally?
2. How is that creature represented mechanically?

Do not collapse them into one unconstrained LLM output.

### Stage 1: canonical creature concept

Establish/validate:

- origin;
- mundane ancestor when applicable;
- morphology;
- size/mass/scale;
- locomotion;
- senses;
- intelligence/behavior;
- ecology/current environment;
- age/survival history;
- setting-defined growth state;
- supernatural theme/capabilities;
- current injuries/conditions;
- previously observed feats/effects;
- death/disintegration/loot implications.

### Stage 2: mechanical constraints

Translate canonical creature truth into rules requirements/bounds without choosing exact values that are not yet needed.

Examples:

- a demonstrated speed constrains Agility/performance;
- observed impact force constrains Strength/Effect possibilities;
- icy armor constrains relevant resistance/status/capability mappings;
- lack of human cognition constrains applicable learned Skills;
- survival/growth history may raise capability constraints.

### Stage 3: realized mechanics

Instantiate only what is required, or a complete creature profile when appropriate:

- species-neutral Attributes;
- creature-appropriate Skills/competencies;
- stress/status data used by supported mechanics;
- supernatural abilities/effects through rules/adapter contracts;
- applicable resistance/provenance;
- creature-specific growth state;
- death/loot behavior linkage.

Monsters do not automatically use human Character XP/Level/Power manifestation semantics.

The reference rules implementation may need to split its current actor mechanics into:

- a reusable mechanical actor core; and
- optional human/player progression extensions.

## Monster growth

Awakening Earth canon says monsters can become substantially stronger over time.

Growth acts on the existing creature identity.

It is not a reason to regenerate a replacement creature.

Package world processes/operations may update creature mechanics when elapsed survival/growth conditions warrant it, using the ordinary validated mutation/event path.

There is no universal challenge rating, rarity ladder, or monster-level system in this design.

## Mechanics-inspection abilities

A game effect may require realization as part of resolving the effect.

The source fiction explicitly includes abilities that can reveal detailed character information and are discussed as useful for analyzing monsters and powered people.

Therefore an authorized mechanics-inspection operation may request:

- targeted realization;
- broader partial realization; or
- complete realization.

The effect receives only the information its own rules allow it to expose. Generation itself remains canonical/private and cannot use the inspecting actor's false beliefs as truth.

## Model-assisted generation

The model proposes structured data; it never directly establishes mechanics.

Pipeline:

1. assemble authoritative constraints;
2. request a structured proposal with the active model runtime;
3. validate against ruleset/setting/adapter schemas;
4. run deterministic no-retcon/coherence checks;
5. repair only invalid portions;
6. commit accepted realization through ordinary mutations.

Use bounded retries and diagnostics consistent with #17's staged generation philosophy.

## Persistence and provenance

Mechanical realization is authoritative and checkpointed.

Persist:

- realization level;
- realized mechanical data;
- hard constraints/links that materially shaped it;
- source component/generator versions;
- generation/densification provenance;
- enough diagnostics to explain later why a value exists.

Previously committed mechanical values are not silently recomputed when prompts/models/generator versions change.

## Verification scenarios

### Human

1. Establish a recurring nurse socially, with biography/occupation but no full rules profile.
2. A medical task requires trained competency.
3. Realize the minimum necessary mechanics.
4. Later an inspection ability requires the full profile.
5. Complete the profile consistently with prior mechanics and biography.
6. Save/reload and verify identical state.

### Monster

1. NPC reports describe an unknown livestock attacker; reports remain beliefs.
2. Canonical tracks establish physical constraints.
3. Direct observation establishes a large cold-associated magical creature.
4. Encounter relevance triggers partial/complete realization.
5. Generated mechanics satisfy every canonical observation but are not constrained by disproven rumor.
6. If the monster survives, later lazy simulation may grow the same creature.
7. If killed, existing Awakening Earth death/disintegration/loot rules resolve normally.

## Non-goals

- full-sheet generation for every population member;
- comprehensive monster taxonomy;
- universal CR/rarity/monster-level mechanics;
- forcing monsters into human progression;
- exhaustive enumeration of open-ended Skills;
- final balance for every future creature/power;
- NPC goals/memory/relationship modeling (#13);
- population identity-resolution (#17);
- character-sheet UI/presentation.
