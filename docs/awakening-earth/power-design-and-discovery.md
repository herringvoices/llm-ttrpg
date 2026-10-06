# Awakening Earth Power Design and Discovery

Awakening Earth powers are individualized supernatural rules. They are not a closed spell list, a rigid class system, or a finite taxonomy.

This document defines the reference game's semantic guidance for creating, retrieving, growing, and experimentally understanding powers. Mechanical progression remains defined by [Character Progression and Abilities](../character-progression-and-abilities.md).

## Core principle

A power establishes one coherent supernatural relationship with the world.

Examples include:

- storing objects in a personal pocket dimension;
- receiving information about a touched target;
- drawing a linked pair of portals;
- becoming briefly immune to new bodily injury;
- changing one's own mass while holding one's breath;
- copying eligible objects and pasting temporary duplicates;
- projecting a straightforward burst of force.

A good power definition establishes enough authoritative behavior for the power to be used now without trying to enumerate every implication it may ever have.

The setting deliberately supports both unusual conceptual powers and plain powers. Supernatural Strength, a ranged force attack, or an enhanced melee impact is as legitimate as Inventory or Copy/Paste. Strange abilities should remain strange partly because ordinary abilities also exist.

## Exemplars are illustrative, not exhaustive

Awakening Earth ships with a scenario-owned exemplar library.

The exemplar library:

- provides actual authored powers that may be used by campaign content;
- demonstrates the range of supernatural rules that fit the setting;
- supplies compact precedents to the LLM when a related power is being generated or reasoned about.

The library is never a whitelist.

A generated power may:

- use a concept absent from every exemplar;
- introduce new semantic tags;
- use a familiar domain in a structurally different way.

The model must not treat retrieved exemplars as character-builder options or merely rename/reskin them.

The initial library includes source-derived powers such as Quest, Help, Inventory, Invincible, Fast Travel, Shock Cloak, Flaming Fist, Combustion, Heat Rising, Predator (Blessing), technology interaction, and a direct eye-force attack. It also includes deliberately varied reference examples such as Copy/Paste, Quick Change, simple stat enhancement, Force Bolt, and Impact.

## Tags are retrieval metadata, not power classes

Powers carry zero or more semantic tags. The relationship is many-to-many.

Useful tag dimensions include:

- domain: fire, space, gravity, body, technology, force;
- operation: create, alter, transfer, store, sense, grant;
- target: self, creature, object, area, information;
- use shape: passive, active, sustained, touch;
- practical role: offense, defense, mobility, utility, support, enhancement.

These dimensions are conventions, not closed enums. A newly generated power may introduce a new tag such as `domain.friction` without an engine schema change.

Tags help with:

- retrieving relevant exemplars;
- finding powers worth comparing;
- supplying compact model context;
- surfacing possible interactions or synergies.

Shared tags do not prove two powers are compatible. The actual supernatural rules remain authoritative.

## Power generation

Power generation is constrained creativity.

Generation context should include only relevant information:

- character history and current state;
- player power preferences and hard negative constraints;
- manifestation level/strength and PP budget;
- existing powers;
- scenario-specific guidance;
- a small set of relevant exemplars;
- relevant known tags.

The model proposes a structured power. The ruleset validates it before it becomes authoritative.

A generated power must:

- fit its manifestation budget;
- preserve one coherent supernatural principle;
- specify current functions, costs, conditions, targets, timing, and limits;
- avoid silently bundling unrelated capabilities;
- respect hard negative preferences;
- avoid accidental duplication of an existing power;
- remain free to invent concepts outside the exemplar/tag sets.

The Awakening Earth player character's first manifested power should be interesting enough to establish the supernatural premise of the campaign. A raw stat-only enhancement is therefore not a valid first player power, although stat enhancements remain valid later powers and valid NPC powers.

## Growth preserves identity

Power growth expands the rule rather than replacing it.

Growth may improve:

- magnitude;
- range;
- duration;
- precision;
- efficiency;
- target count;
- valid target types;
- activation flexibility;
- closely related consequences.

A milestone may substantially broaden a power while remaining recognizably the same supernatural principle.

For example, Copy/Paste may begin with liftable non-living objects, later change how transformed/consumed duplicates count against its mass budget, and eventually permit living targets. Those are major expansions, but they remain about copying and pasting.

An unrelated ability does not become valid merely because it shares an aesthetic theme.

Do not pre-generate complete late-game trees. Future functions are generated from established principle, growth profile, development axes, current functions, and actual play.

## Synergy is emergent

A power does not need to be impressive in isolation.

Heat Rising is an important precedent: reducing gravity's effect on the user is modest by itself, but its interaction with Combustion may make flight possible.

The game should normally discover such combinations by reasoning over the actual rules. Tags can help retrieve powers that may interact, but hardcoded combo definitions should be exceptional.

## Discovery through experimentation

The initial power description is authoritative but not omniscient.

Players may deliberately test consequences that are not yet specified. An experiment can resolve as:

- **already specified**: existing authoritative rules already answer it;
- **valid implication**: the attempted use clearly follows from the established power rule;
- **invalid implication**: it conflicts with an established principle, function, target, condition, or limit;
- **check required**: the power permits the attempt, but ordinary uncertainty/mechanics must resolve success;
- **new canonical edge behavior**: the attempted use requires the simulation to settle a reusable rule not previously specified.

The LLM may propose the semantic adjudication, but narration does not make the ruling authoritative.

When a new reusable edge behavior is settled, it is committed to the power's persisted state and becomes precedent for future turns.

The game should settle the narrowest rule actually required by play. It should not answer unnecessary metaphysical questions in advance.

For example, if Copy/Paste eventually permits living targets, the game does not need to pre-decide whether a duplicate has metaphysical identity continuity, whether dismissal is death, or whether a duplicate can resist dismissal. Those questions become authoritative only when actual play requires a ruling.

## Authoritative power state

A persisted power can distinguish:

1. **core principle**: the stable supernatural identity;
2. **manifested functions**: capabilities currently unlocked and mechanically usable;
3. **committed milestones**: breadth unlocked through progression;
4. **discovered behaviors**: reusable edge rulings established through authored rules or play;
5. **tags**: non-authoritative semantic metadata for retrieval/context.

Narration may describe these facts. It may not independently add to them.

## Framework ownership

Keep these boundaries explicit:

- the generic engine owns orchestration, persistence, and generic operation contracts;
- the ruleset owns the mechanical power schema, progression constraints, and authoritative mutations;
- Awakening Earth owns its exemplar library, semantic tag vocabulary, and genre-specific generation guidance;
- campaign content may assign or reference powers but does not redefine the ruleset schema;
- presentation/narration describes validated outcomes only.

A different game package may ship a completely different exemplar library and guidance without requiring Awakening Earth concepts in the engine.
