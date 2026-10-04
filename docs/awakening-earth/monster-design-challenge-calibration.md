# Awakening Earth: Monster Design, Threat Calibration & Encounter Composition

**Status:** Canonical design source for Issue #35  
**Scope:** Monster archetypes, signature abilities, threat envelopes, party-relative challenge calibration, encounter composition, rules-grounded challenge audits, and the boundary between authored/player-targeted threats and simulation-originated threats.

## Purpose

A mechanically valid monster is not automatically a good game challenge.

Awakening Earth needs monsters that:

- make fictional sense;
- create interesting decisions rather than merely absorbing attacks;
- interact meaningfully with the current player/party's actual capabilities;
- can be deliberately generated at an intended challenge when the game is creating player-facing content;
- and still exist independently of the player when the simulation produces them.

Issue #34 owns mechanical realization: turning established creature constraints into partial or complete rules state.

Issue #35 owns the design constraints that tell #34 what sort of monster/encounter it is trying to realize.

## Do not use one scalar as the source of truth

The legacy character-sheet work experimented with **Monster Rarity** and **Monster Level**.

Do not make one universal Monster Level, CR, or rarity value authoritative for challenge calibration in the current system.

The current game has:

- open-ended skills;
- open-ended supernatural powers;
- no combat-round/initiative action economy;
- continuous fictional time;
- multi-axis Stress, statuses, and Effect;
- variable party size;
- highly variable equipment, preparation, and current resources.

Two parties with identical Character Levels can have radically different answers to the same monster.

Character Level remains a useful coarse input. It is not the balance algorithm.

A scalar threat estimate may later be derived for presentation or an in-world institution, but it must be treated as a lossy estimate over richer state.

## Creature archetypes and instances

### Creature archetype

A **Creature Archetype** defines a recognizable kind of monster.

It may contain:

- stable ID/name;
- core supernatural principle;
- valid origin types;
- morphology and ordinary size/scale range;
- locomotion and senses;
- baseline intelligence/behavior/ecology;
- baseline capability ranges;
- signature ability family;
- ordinary tells;
- ordinary counterplay;
- growth tendencies;
- instance-variation hooks;
- setting-valid death/loot linkage.

An archetype is not required to be globally canonical setting content.

It may be:

- setting-authored;
- campaign-authored;
- generated for one campaign and later reused there.

A spontaneous one-off creature may establish a campaign-local archetype if recurrence is plausible.

The game should not invent an unrelated species for every encounter merely to create novelty.

### Creature instance

A **Creature Instance** is one actual monster in World State.

It records/refers to:

- archetype when applicable;
- concrete origin and history;
- current morphology/size;
- current growth state;
- injuries/conditions;
- location;
- constrained/partial/complete mechanical state;
- instance-specific variations;
- canonical observations and relevant event history.

An instance persists as itself. Later growth modifies that creature rather than regenerating a replacement.

## Interesting-monster contract

A meaningful player-facing monster needs an interaction identity beyond numerical strength.

At minimum, establish:

1. **Core principle**  
   One coherent fictional/supernatural idea explains the creature's major unusual capabilities.

2. **Behavior**  
   What the creature wants and how it tends to act: territorial, predatory, curious, defensive, parasitic, pack-oriented, intelligent, etc.

3. **Signature interaction**  
   At least one trait/ability changes player decisions rather than merely adding generic damage.

4. **Tell**  
   Observable evidence lets players notice, infer, research, or learn about the unusual interaction.

5. **Counterplay**  
   At least one plausible response can mitigate, exploit, avoid, prepare for, or otherwise interact with the signature threat.

6. **Mechanical threat**  
   If mishandled, the creature has a plausible path to meaningful consequences.

A low-threat/simple monster may satisfy this with one strong signature rule.

A high-threat monster may have several abilities, but they should remain tightly related to the same supernatural identity.

Interesting does **not** mean:

- unrelated random powers;
- mandatory videogame phases;
- mandatory elemental weaknesses;
- giant durability with no new decisions;
- invisible gotcha mechanics with no tell.

## Monster abilities

Use the same constrained-creativity principles that govern human power generation where they fit.

Evaluate monster abilities across:

- potency;
- reach/range;
- target count/scope;
- duration;
- precision/control;
- efficiency/cost;
- versatility;
- restrictions/prerequisites;
- telegraphing;
- counterplay.

Monster abilities do not automatically use:

- human PP;
- human Manifestation Strength;
- human Character Level;
- human Mana;
- human power-acquisition rules.

The active ruleset/adapter decides the exact mechanical form.

The source material provides useful design examples rather than final mechanics:

- the rage-tail's heated tail and scalding blood punish particular ways of engaging it;
- the frost felid's icy body and freezing attacks produce one coherent cold-based threat.

The useful lesson is not those exact abilities. It is that a monster's theme should materially change interaction.

## Monster behavior

Monster behavior is fictional, not optimal tactical AI.

A monster acts according to:

- intelligence;
- instincts;
- hunger/fear;
- territoriality;
- injury;
- protectiveness;
- pack/social behavior;
- learned experience;
- current circumstances.

A predator does not automatically attack the mathematically weakest PC.

A wounded territorial animal may flee.

A nesting creature may prioritize blocking access rather than killing everyone.

A sentient monster can use #13's richer actor state when it genuinely has persistent goals, beliefs, relationships, or memories.

## Threat envelope

Establish a durable **threat envelope** when a creature/archetype becomes canonical, before every exact mechanical value is necessarily known.

The threat envelope constrains later realization.

Useful dimensions include:

- overall intended threat range;
- offensive pressure;
- survivability/durability;
- mobility/reach;
- control/denial;
- sensory/information advantages;
- multi-target pressure;
- resource pressure;
- special hard-counter risk;
- required signature capabilities;
- required tells/counterplay;
- allowed growth range.

The exact schema belongs to the active ruleset/setting-adapter.

The generic engine treats the package-validated envelope as opaque canonical/generation data.

Later #34 densification must fit the existing envelope.

It may not inspect today's party and secretly choose whatever exact stats would create a balanced fight.

## Party capability snapshots

When the game deliberately creates **new player-targeted content**, it may calibrate against an expected party snapshot.

Do not use Character Level alone.

Consider relevant:

- expected participants;
- Character Levels where applicable;
- Attributes;
- Skills;
- current power functions;
- ordinary equipment/resources;
- party size;
- meaningful power/skill synergies;
- important coverage gaps;
- normal access to recovery/healing;
- already-established knowledge/preparation.

### Baseline capability vs current condition

Store/derive both concepts separately.

**Baseline capability** asks what the group normally can do at the current progression point.

**Current condition** includes temporary:

- Mana depletion;
- Stress;
- injuries/statuses;
- damaged/lost equipment;
- other immediate disadvantages.

New player-targeted monsters should normally be calibrated against **baseline capability**.

Current condition can influence pacing and whether the content system chooses to surface a confrontation now.

It must not cause an already-defined monster to mysteriously become weaker.

## Challenge bands

A player-targeted direct confrontation may request one of five design bands.

### Routine

The group should handle the threat reliably with ordinary competent play and little lasting cost.

Useful for:

- demonstrating growth;
- low-stakes complications;
- making ordinary dangerous work feel ordinary.

### Challenging

The group is favored, but the encounter should require meaningful decisions and can consume real resources or create Stress/status consequences.

This is a primary default band for ordinary player-facing monster content.

### Hard

There is substantial danger.

Poor choices, bad luck, or a bad matchup can take someone out. Good use of abilities, environment, teamwork, or preparation matters materially.

This is the other primary default band for significant monster content.

### Severe

Victory is plausible, but serious defeat/retreat is also plausible.

Strong play, preparation, favorable circumstances, creative problem solving, or help may be required.

### Overwhelming

Directly defeating the threat is not presented as a fair expectation.

The meaningful challenge is instead something such as:

- escape;
- survival;
- rescue;
- hiding;
- delaying;
- observing;
- learning its weakness;
- recruiting help;
- changing the battlefield;
- returning later.

Overwhelming threats are valid content when the game does not falsely frame direct combat as the expected fair solution.

### Meaning of the bands

The bands are:

- generation/audit targets;
- not guaranteed outcomes;
- not necessarily player-visible;
- not in-world metaphysics;
- not XP categories.

## No world-wide level scaling

Simulation-originated monsters do not inspect the player.

Their threat follows:

- origin;
- archetype;
- environment;
- age/survival;
- growth;
- world events/processes;
- other canonical causes.

A weak player can discover a dangerous old monster.

A powerful party can run into a weak new monster.

That is desirable world coherence.

The game should support:

- warning signs;
- research;
- scouting;
- flight;
- calling for help;
- preparation;
- alternate routes;
- later return.

Appropriate **content** does not require every creature in the world to be an appropriate fair fight.

## Player-targeted content may calibrate at creation

When the campaign/content system deliberately creates a **new** monster/encounter to provide player-facing content, the intended challenge band and expected party capability may constrain generation.

That influence is recorded in generation provenance.

The correct sequence is:

1. determine that new player-facing supernatural content is warranted;
2. capture the relevant baseline party capability;
3. choose an intended challenge band;
4. generate/select archetype and threat envelope;
5. realize enough mechanics through #34;
6. audit the whole scenario;
7. locally repair before commitment if needed;
8. commit.

After commitment, the monster exists independently.

Do not keep rebalancing it as the party changes.

## Existing/coarse threats cannot be rubber-banded during densification

A monster may be canonical before all mechanics are realized.

That does **not** provide permission to use the current party as a hidden balancing input later.

If the monster already has a threat envelope, #34 realizes within it.

If an older coarse monster lacks an envelope, derive one from its:

- origin;
- age/growth;
- archetype;
- environment;
- established observations;
- prior effects/history.

Do not derive it from whoever happens to encounter it.

## Encounter composition

Challenge belongs to the **whole situation**, not one monster.

A confrontation may include:

- one creature;
- several creatures of one archetype;
- several complementary archetypes;
- hazards;
- terrain;
- objectives/innocents;
- escape/time pressure;
- allied NPCs.

Do not add monster threat values linearly.

Multiple independent actors change:

- attention;
- timing;
- positioning;
- mobility;
- control;
- target coverage;
- opportunities for interruption/help.

Generated groups must make fictional sense, for example:

- pack;
- nest;
- migration;
- symbiosis;
- parent/offspring;
- Gate ecology;
- territorial overlap caused by a concrete event.

Do not build MMO tank/healer/DPS compositions unless the fiction actually supports those roles.

## Challenge audit

Before newly generated player-targeted monster content becomes authoritative, audit the candidate scenario.

### Affectability

At least one plausible party route can meaningfully affect the threat.

This does not require every PC to be equally effective.

### Threat

The threat has at least one plausible route to meaningful consequences against the expected group.

### Decision quality

Signature abilities change choices rather than producing only repeated attrition.

### Counterplay

Important unusual interactions have observable/researchable responses.

### Hard-counter review

The scenario should not accidentally invalidate essentially every meaningful party option.

An intentional hard counter is permissible only when that is the designed situation and non-suicidal alternatives exist.

### Durability / tempo

Do not create challenge only by requiring the same successful action to be repeated excessively.

### Party-size pressure

Check the scenario against the expected number of active participants.

One dangerous single-target creature and five weaker independent enemies create very different timing/attention problems even if a crude scalar would call them equal.

### Resource pressure

Likely consumption/consequence is consistent with the intended challenge band.

### Escape / alternate approach

Severe and Overwhelming threats must not rely on invisible walls or narrative coercion to force direct combat.

### Fictional coherence

Any tuning must remain consistent with the archetype, setting, environment, and previously established truth.

## Rules-grounded scenario probes

The LLM may help propose:

- representative player approaches;
- representative monster behaviors;
- likely capability interactions to test.

It may not simply declare the encounter balanced.

Use the real registered rules operations in a disposable cloned/test state with deterministic seeds to probe important interactions.

Issue #16 should provide the test substrate.

The goal is not exact win probability or a perfect combat AI.

The goal is to catch obvious failures such as:

- nobody in the party can meaningfully affect the monster;
- the monster cannot meaningfully threaten anyone;
- one unavoidable action trivially wipes the expected group;
- repeated identical actions dominate the entire interaction;
- one party capability completely trivializes every monster feature;
- the encounter clearly falls outside its intended challenge band.

A same-level party with materially different power composition must be allowed to receive a different audit result.

## Local repair before commitment

If a newly generated player-targeted candidate misses its challenge target, repair only what is necessary.

Possible repairs:

- tune Attributes/capability inside the concept's allowed range;
- adjust ability potency/range/duration/targeting/cost;
- strengthen or clarify tells/counterplay;
- change creature count;
- change group composition;
- adjust environment/objective;
- select another valid archetype.

Do not regenerate unrelated world/campaign content.

After commitment/observation, difficulty is no longer a reason to edit the creature.

Only normal fictional development may change it.

## Progression and rewards

Challenge bands do **not** set XP.

#22 intentionally uses the actual experienced:

- Stretch;
- Growth;
- Novelty;
- Stakes;
- Agency;
- Magical Resonance.

A supposedly Hard encounter that the party cleverly trivializes may be a very different growth event from one that pushes everyone to their limits.

Likewise, challenge bands do not directly define loot value.

Loot remains downstream of setting/creature/death state and future structured loot rules.

## Relationship to other issues

### #34 Character & Creature Mechanical Generation

#35 produces/arbitrates the creature concept and threat envelope.

#34 realizes the required exact mechanics without violating them.

### #26 Content & Encounter Principles

#26 decides when/why/how situations become player-facing and how grounded hooks/consequences work across combat and noncombat content.

#35 decides whether a monster confrontation generated for that content is mechanically and interactively appropriate.

### #16 Simulation & Test Harness

#16 supplies the repeatable disposable-world execution environment used for scenario probes and later balance regression tests.

### #17 Starting Region Generation

#17 may seed supernatural pressures and concrete monster instances.

When an initial monster is intended as near-term player-facing content, #17 should use #35 to establish an appropriate threat envelope at creation.

Background/simulation threats need not be party-calibrated.

## Verification

### Same level, different composition

Create two parties with identical Character Level distribution but materially different Skills/Powers.

Evaluate the same monster.

The challenge audit may produce different bands/results.

### Deliberately generated Hard encounter

1. capture baseline party capability;
2. request a Hard supernatural situation;
3. generate/select an archetype and threat envelope;
4. realize mechanics through #34;
5. run deterministic-seeded scenario probes;
6. perform local repair until the candidate satisfies the Hard audit;
7. commit;
8. temporarily injure/deplete the party;
9. verify the monster does not become weaker.

### Simulation-originated danger

1. a monster arises off-screen through normal simulation;
2. it survives and grows;
3. its threat follows its own history, not player capability;
4. a weaker PC discovers signs of it;
5. danger is meaningfully telegraphed when fiction permits;
6. avoidance/help/preparation remain valid;
7. after later progression, the player can return to the same persisted threat.
