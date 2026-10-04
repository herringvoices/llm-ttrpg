# Reference Rules

The selected reference ruleset is a reusable, setting-neutral RPG rules package. It supplies concrete mechanics through the generic engine's operation and resolution contracts; none of these concepts are engine-level schemas.

## Character capabilities

Every mechanically modeled actor uses the same 18 open-ended, species-neutral attributes. Physical attributes are Strength, Endurance, Durability, Agility, Perception, and Fine Motor Skills. Mental attributes are Critical Thinking, Learning, Focus, Memory, Creativity, and Improvisation. Social attributes are Presence, Empathy, Attractiveness, Cool, Social Fluency, and Self-Awareness.

Attributes are raw commensurable capabilities, not percentiles or human-normalized ratings. Relevant attribute values receive their own percentage modifiers and are then averaged without intermediate rounding.

Skills are independent, open-ended learned competencies. Each stores an ID, name, semantic description, specificity from 1 (broad field) through 4 (specialization), and fractional SP. Level is derived rather than independently authored:

```text
level = floor((4 * SP / 5)^(1/3))
```

Ranks are Novice (1–2), Apprentice (3–4), Journeyman (5–6), Expert (7–9), and Master (10+). A skill has no fixed governing attribute. Orchestration proposes relevant attributes and applicable skills for the declared approach; the rules validate those references, calculate every applicable contribution, and select only the strongest:

```text
trainedCapability = attributeBasis * (1 + level * specificity * 0.05)
```

## Performance and Resistance

All ordinary uncertainty uses one `rules.actions.resolve-action` operation. It covers physical, mental, social, environmental, competitive, and timing situations without a combat mode.

Calculation order is:

1. validate fictional feasibility and participant references;
2. apply modifiers to individual attributes;
3. average the relevant modified attributes;
4. calculate applicable skill contributions and select the strongest;
5. apply broader situational, equipment, status, assistance, and stress modifiers;
6. calculate the ±15% plausible Performance range;
7. classify the attempt before RNG;
8. for uncertainty only, apply deterministic triangular variance;
9. compare exact final Performance against Resistance.

Fixed Resistance is direct, authored, or benchmark-calibrated and carries provenance. Opposed Resistance is another actor's Performance from the same calculation. A tie does not overcome Resistance.

```text
fixed automatic: actor minimum > Resistance
fixed impossible: actor maximum <= Resistance

opposed automatic: actor minimum > opponent maximum
opposed impossible: actor maximum <= opponent minimum
```

Everything else is uncertain. Uncertain variance consumes two d16-equivalent draws from the engine's deterministic local stream:

```text
variancePercent = d16 + d16 - 17
finalPerformance = deterministicPerformance * (1 + variancePercent / 100)
```

The structured basis preserves raw/modified attributes, all considered skills, the selected skill, modifiers, stress, deterministic Performance, plausible range, Resistance and provenance, Effect plan, and classifications. The result preserves rolls, exact final values and margin, consequences, SP evidence, and timing. No intermediate mechanical value is repeatedly rounded.

## Modifiers, assistance, and stress

Default modifier magnitudes are Minor ±5%, Significant ±10%, Major ±20%, and Extreme ±40%. Modifiers affecting the same component add before multiplication, but submitted circumstance stacks may not exceed the Extreme band; beyond that point orchestration must change feasibility, Effect, timing, or fictional state instead. Ordinary useful help contributes +5% per helper, with an explicit fictionally justified helper limit. When physical capability literally combines, participant attributes are read from authoritative state and combined before the relevant attribute calculation instead of becoming helper bonuses.

The five stress tracks are Injury, Fear, Anger, Exhaustion, and Insecurity. Each point applies -5% overall Performance; the cross-track penalty caps at -70%. A track reaching 5 means Taken Out. The result records the responsible track, contextual status, and whether a normally fatal PC outcome is waiting for explicit consent. It never hard-codes death or prose narration.

Statuses are persistent fictional facts with specific attribute/performance consequences and remain distinct from stress. They can outlast recovered stress.

## Potential and Realized Effect

Potential Effect (1–3) is established before resolution from method, scope, equipment, preparation, scale, and circumstances. It is not raised by skill or a good roll. Failure realizes Effect 0.

Successful fixed/contextual Effect realizes the Potential Effect. Derived Effect is deterministically supplied with its basis and cannot exceed Potential Effect. Independently uncertain Effect uses another normal Performance check only when magnitude is genuinely a separate uncertainty. Central thresholds are `R`, `R × 1.15`, and `R × 1.30`; the result is capped by Potential Effect. A connected strike can therefore succeed while independently checked impact realizes Effect 0.

Exact numeric margin remains diagnostic data. It never automatically raises Effect or SP. Stress-producing success normally applies Realized Effect directly to the selected track; non-stress Effect can instead describe scope, such as how far a rumor propagates.

## Learning and recovery

Only uncertain checks award use-based skill SP. Failure teaches. Awards use Potential Effect:

| Potential Effect | Failure | Success |
| --- | ---: | ---: |
| 1 | 0.25 SP | 0.50 SP |
| 2 | 0.50 SP | 1.00 SP |
| 3 | 0.75 SP | 1.50 SP |

The same skill is awarded at most once for one declared action even when success and Effect are independent checks. Evidence is persisted with the actor. A generic actor-level learning-rate multiplier is an explicit extension hook; setting-specific accelerated learning remains outside this reusable package. Five skill points per character level remains a progression invariant, but issue #22 owns level-up allocation and the formulas that determine such multipliers.

`rules.skills.create-emergent-skill` accepts an authorized learning/discovery proposal only after orchestration supplies semantic duplicate and specificity review. Deterministic rules validate all mechanical bounds and reject a review that marks the proposal duplicate or artificially over-narrow. Discovery begins at the exact Level-1 threshold of 2 SP; learning may begin internally at Level 0.

`rules.recovery.recover-stress` requires a cause-appropriate recovery basis. Once conditions exist, ordinary non-Injury cadence is one point after about ten minutes, another for each additional hour, or all remaining ordinary stress after restful overnight sleep. Injury requires treatment/healing with an explicitly justified amount. Recovery never silently removes statuses.

## Repeated, extended, and high-pressure action

Repeated attempts require a real change in time, action window, approach, preparation, resources, or circumstances. Extended work is validated as at least two meaningful stages whose competency, Resistance, circumstances, consequences, or decisions change.

There are no combat rounds, initiative, action points, or universal reactions. A reaction is an ordinary action entering the same timeline when awareness and available time permit it. Material effects are ordered by continuous fictional time. Obvious timing is ordered directly; ties can be simultaneous; genuinely uncertain order uses the same opposed action operation with contextually relevant attributes and skills. Preparation may reduce time to material effect.

These operations expose duration and timing semantics compatible with Action Pressure. They do not implement the multi-intent scheduler, cumulative horizon loop, or player-control stop conditions owned by issue #11.

## Starting humans, awakening, and mechanical realization

Starting human mechanics are generated from normalized player-established facts. Attribute departures from the mundane baseline and every starting Skill require explicit evidence links; the complete Level-0 profile is validated before campaign initialization.

The first awakening is an ordinary authoritative rules operation. It accepts only an unawakened Level-0 human, allocates exactly five Skill Points to established Skills with event evidence, crosses the character to 2 XP / Level 1, derives maximum Mana from Endurance + Cool, and manifests one legal Strength-1, Power-Level-1 ability with the initial five-PP budget. The operation commits mechanics and a canonical event; opening prose alone cannot awaken a character.

Human and creature mechanical realization use the shared `unrealized → constrained → partial → complete` ladder. Densification may add missing state but cannot rewrite prior values or history. Creatures use the species-neutral mechanical core without human progression fields, and an established threat envelope must be present among the constraints consumed by their realization. Creature growth updates the same authoritative creature through an ordinary validated operation rather than regenerating it.

## Semantic boundary

The LLM/orchestration layer may propose approach, relevant attributes/skills, circumstances, helper limits, Resistance provenance, Potential Effect/mode, stress target, status, timing, and emergent-skill semantic review. The ruleset validates and computes mechanics. The engine validates generic operation envelopes, commits proposed state/events/time atomically, and supplies deterministic RNG only after the ruleset classifies uncertainty. Narration consumes the recorded result and cannot change it.

Character-level progression, automatic allocation, powers, and Mana are specified separately in [Character Progression and Abilities](character-progression-and-abilities.md). Those mechanics belong to the selected ruleset; Awakening Earth-specific supernatural sources, lore, availability, and social meaning remain setting/adapter concerns.
