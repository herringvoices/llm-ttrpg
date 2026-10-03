# Character Progression and Abilities

Issue #22 defines the selected reference ruleset's character-progression model and the Awakening Earth adapter/setting boundaries around it. The engine remains generic: it validates and commits structured operations, state, events, time, and RNG, but it does not define XP, levels, attributes, skills, powers, mana, or power growth.

## Ownership boundary

- **Ruleset:** character XP/level math, threshold advancement, attribute/skill/power-point budgets, automatic allocation constraints, power-state schemas, power growth profiles, mana, costs, prerequisites, passive/active effect mechanics, and validation.
- **Awakening Earth setting:** why people awaken, what events are magically resonant, the fact that human powers are individualized, public/hidden understanding of progression, and setting-specific availability/social meaning.
- **Awakening Earth adapter:** maps setting events and concepts into validated ruleset progression operations.
- **Engine:** stores opaque validated state, executes package operations, advances fictional time, and commits state/events atomically. Narration has no authority to grant XP, levels, points, powers, or effects.

## Character level and XP

Character XP is authoritative nonnegative integer state.

Character Level is derived:

```text
characterLevel = floor((4 * XP / 5)^(1/3))
```

The minimum XP for level `L` is:

```text
threshold(L) = ceil(5 * L^3 / 4)
threshold(0) = 0
```

Early thresholds are 0, 2, 10, 34, 80, 157, 270, and 429 XP for Levels 0 through 7.

Level 0 is real. An unawakened human is Character Level 0. Before awakening, ordinary mundane experience does not accumulate Character XP. Only an explicitly magical or magically resonant source can begin progression. Crossing the Level-1 threshold awakens the character and manifests the first power.

After awakening, meaningful mundane experience can also contribute XP because magic is now part of the character's growth.

One XP award may cross multiple thresholds. Threshold effects resolve sequentially in ascending level order.

## XP award rubric

There is intentionally no universal encounter-to-XP table. The LLM proposes an XP award at a meaningful resolution boundary and supplies its reasoning in structured form; the ruleset validates the band, amount, eligibility, and resulting state update.

Typical resolution boundaries include a monster encounter, a substantial training session, a consequential conversation, an investigation, a difficult physical obstacle, a power experiment, or another coherent challenge. Do not award XP for every atomic action.

### Primary sources

1. **Monster defeat or meaningful participation** has the highest ordinary XP ceiling.
2. **Power use, experimentation, stretching, and deliberate practice** has the next-highest ordinary ceiling.
3. **General growth** can come from meaningful physical, mental, social, occupational, investigative, relational, or other challenges.

An authored ability may grant exact XP through its own validated mechanic. Such a grant is not retroactively justified by narration and does not use the emergent-event rubric unless that ability explicitly says it does.

### Evaluation lenses

For an emergent XP proposal, assess:

- **Stretch:** how far beyond routine/current capability was the experience?
- **Growth:** did the character actually learn, adapt, practice, or develop?
- **Novelty:** was this meaningfully different from already-mastered repetition?
- **Stakes:** how consequential, dangerous, pressured, or difficult was it?
- **Agency:** how much did this character actually contribute?
- **Magical resonance:** was the event directly tied to monsters, powers, Gates, or another established magical growth source?

Failure can award XP. Repetition rapidly loses Growth and Novelty unless circumstances, difficulty, technique, or discovery materially change. Repeating an already-mastered action solely to farm XP should normally award none.

### Award bands

Let the current level span be:

```text
levelSpan = threshold(characterLevel + 1) - threshold(characterLevel)
```

The LLM chooses a qualitative band and a value inside that band, justified by the lenses above:

| Band | Ordinary guidance as fraction of current level span |
| --- | ---: |
| None | 0 |
| Minor | 1-3% |
| Meaningful | >3-7% |
| Significant | >7-15% |
| Major | >15-25% |
| Exceptional | >25-50% |

For a nonzero band, the final award is an integer and cannot round below 1 XP.

Awards above 50% of the current level span are allowed only through an explicit exceptional override with a recorded reason. This preserves room for genuinely extraordinary magical events without turning the rubric into a hidden encounter table.

Source guidance is comparative rather than absolute:

- monster participation can legitimately occupy the full range;
- power development commonly reaches Meaningful through Major and can be Exceptional for a genuine breakthrough;
- general growth is commonly Minor through Significant and reaches Major only when the experience is unusually transformative.

These are defaults, not conversion rules.

## Threshold advancement

When the character crosses into Character Level `L`, process the threshold in this order:

1. determine whether a new power manifests at this Character Level;
2. apply universal Attribute growth;
3. calculate newly available discretionary Attribute Points;
4. add the level's 5 Skill Points;
5. recalculate the total Power Point budget;
6. reserve any required new-power seed PP;
7. use development evidence to propose the remaining Attribute/SP/PP allocation;
8. validate every allocation and resulting derived level;
9. commit progression atomically;
10. present the player with an exact advancement report.

The character does not normally choose allocations. An explicit ability may grant control over some or all allocation, as Liam's unusual progression interface does in the source material.

The player is still told exactly what changed. Player-facing progression information is not automatically a diegetic interface visible to the character.

## Attribute growth

The 18 ruleset Attributes remain the authoritative raw-capability values.

### Universal growth

Threshold growth becomes more rewarding at higher levels. Define cumulative universal growth per Attribute as:

```text
universalAttributeGrowth(L) = floor(L^2 / 4)
```

Equivalently, crossing into level `L` increases **every Attribute** by:

```text
universalIncreaseAtLevel(L)
  = universalAttributeGrowth(L) - universalAttributeGrowth(L - 1)
  = floor(L / 2)
```

Examples:

| New Character Level | Increase to every Attribute |
| ---: | ---: |
| 1 | +0 |
| 2 | +1 |
| 3 | +1 |
| 4 | +2 |
| 5 | +2 |
| 6 | +3 |
| 7 | +3 |
| 8 | +4 |
| 10 | +5 |
| 20 | +10 |

At Level 10, universal threshold growth has contributed +25 to every Attribute. At Level 20 it has contributed +100.

### Individualized Attribute Point budget

Retain Liam's spreadsheet's `1.5 * numberOfPowers` term, not the `2 * numberOfPowers` variant found in the other legacy sheets.

Let `P` be the number of manifested powers after processing any new power at the current Character Level.

The cumulative discretionary Attribute Point entitlement is:

```text
discretionaryAttributeEntitlement(L, P) =
  0                                      if L < 2
  max(0, floor(4 * L - 1.5 * P))         otherwise
```

The Attribute Points newly available at a threshold are the increase in this cumulative entitlement since the previously committed threshold, plus any explicit bonus Attribute Points.

The target Attribute total can therefore be audited as:

```text
startingAttributeTotal
+ 18 * universalAttributeGrowth(characterLevel)
+ discretionaryAttributeEntitlement(characterLevel, powerCount)
+ bonusAttributePoints
```

Attribute Points are whole points. The ruleset floors the `1.5 * P` result only at the final entitlement calculation.

## Skill growth

Skills retain the existing ruleset model:

```text
skillLevel = floor((4 * SP / 5)^(1/3))
```

Skills grow in two independent ways:

1. use-based SP from meaningful uncertain checks, as already defined in `reference-rules.md`;
2. **5 level-up Skill Points for every Character Level crossed**.

Level-up Skill Points are whole SP and are allocated automatically from development evidence. They may reinforce an existing skill or begin/advance a credible emergent skill. A new skill still follows the existing semantic duplicate/specificity validation and does not become Level 1 until it reaches 2 SP.

Use-based SP is not deducted from the five-point level-up budget.

## Automatic allocation rubric

Automatic allocation is evidence-driven, not build optimization. The LLM proposes allocations from the character's development evidence since the last committed threshold. The proposal records the evidence it relied on; deterministic rules validate totals, references, and any hard eligibility constraints.

Common evidence includes repeated practice, meaningful strain, adaptation, instruction, experimentation, consequential success or failure, and persisted action/event records.

### Attribute Points

Allocate toward Attributes that were repeatedly and meaningfully demanded or developed.

Prefer:
- repeated exertion over one lucky action;
- demonstrated strain/adaptation over hypothetical future usefulness;
- the character's actual behavior over the mechanically strongest build.

Do not allocate to an Attribute solely because it would optimize a known future encounter.

### Level-up Skill Points

Allocate toward competencies the character actually practiced, studied, or meaningfully exercised.

A new skill may receive SP only when there is credible learning/discovery evidence for that competency. The ruleset's existing emergent-skill semantic review still applies.

### Power Points

Allocate toward powers the character meaningfully used, stretched, tested, or learned about since the previous threshold.

Using a power does **not** directly award PP. Instead:

```text
power use/practice
-> can earn Character XP
-> Character Level threshold
-> new PP budget
-> evidence-based PP allocation
```

This is the ordinary causal link between practicing a power and that power growing.

If evidence is genuinely tied after applying the rubric, the LLM may choose among tied allocations but must record that the choice was underdetermined rather than pretending one option was mechanically required.

## Power Point budget and Power Level

Power Level is derived from PP:

```text
powerLevel = floor((4 * PP / 5)^(1/3))
```

The cumulative PP budget is retained from the source sheets:

```text
totalPowerPointBudget =
  floor((5 + 0.5 * numberOfPowers) * characterLevel)
  + bonusPowerPoints
```

Newly available PP is the increase in that budget since the previous committed threshold.

PP is ordinarily created only by Character Level advancement or an explicit exceptional mechanic.

## Power acquisition

A character manifests:

- the first power at Character Level 1;
- one additional power at every prime-numbered Character Level: 2, 3, 5, 7, 11, 13, 17, ...

The newly manifested power is generated before that threshold's point budgets are finalized, so it counts toward `numberOfPowers`.

### New-power seed

A newly manifested power receives **2 PP from the normal threshold PP budget**, which is exactly enough to make it Power Level 1.

At Character Level 1 there are no older powers to receive evidence-based allocation, so the initial power receives the entire initial PP budget. With one power at Level 1, that budget is 5 PP; the power is still Power Level 1.

At later prime Character Levels:

1. reserve 2 PP for the new power;
2. allocate the remaining newly available PP only among previously existing powers according to development evidence;
3. the newly manifested power receives no additional same-threshold PP merely because it is new.

If one XP award crosses several Character Levels at once, powers manifested during that multi-threshold transition remain seed-only for all thresholds resolved by that same XP event unless an explicit mechanic provides separate development evidence.

This preserves the distinction between **manifestation** and **development**.

## Manifestation Strength

Later-unlocked powers are inherently capable of being more substantial even when they are still Power Level 1.

Every power stores immutable Manifestation Strength:

```text
manifestationStrength =
  1 + floor(characterLevelAtManifestation / 2)
```

Examples:

| Character Level at manifestation | Manifestation Strength |
| ---: | ---: |
| 1 | 1 |
| 2 | 2 |
| 3 | 2 |
| 5 | 3 |
| 7 | 4 |
| 11 | 6 |
| 13 | 7 |
| 17 | 9 |

Manifestation Strength describes the power's starting supernatural budget. It can affect initial potency, scope, range, duration, precision, efficiency, versatility, restrictions, and coefficients.

It does not increase later. **Power Level** measures subsequent development.

For the same basic concept and growth profile, a higher-Manifestation-Strength version should never be strictly weaker in aggregate than a lower-strength version.

## Power definition

When a power manifests, authoritative state must establish at least:

- stable power ID and name;
- core supernatural principle;
- Character Level at manifestation;
- immutable Manifestation Strength;
- growth profile;
- PP and derived Power Level;
- initial functions;
- exact costs, conditions, targets, timing, and limits needed for deterministic use;
- quantitative scaling formulas where applicable;
- development axes/tendencies that constrain future functionality;
- already manifested milestone functions.

Do **not** pre-generate a complete late-game power tree. Future milestone functionality is generated when needed from the already-authoritative core principle, development axes, current functions, Manifestation Strength, growth profile, and the character's actual use of the power.

Once a new function is validated and committed, it becomes permanent authoritative power state.

A later advancement cannot violate or casually replace the power's established core principle.

## Power growth profiles

Every power has one mechanical growth profile.

### Milestone

A Milestone power primarily gains **breadth**.

- It receives a new coherent function at **every prime-numbered Power Level**: 2, 3, 5, 7, 11, 13, 17, ...
- It receives little or no generic continuous numeric growth.
- Non-prime Power Levels may represent accumulated development without a new manifested function.

### Scaling

A Scaling power primarily gains **depth**.

- It has no default prime-level functionality unlock.
- Its core quantitative effect becomes substantially stronger as Power Level rises.
- Its definition contains exact formulas for the values that scale.

The preferred shared growth input is:

```text
powerGrowthUnits(PL) = floor(PL^2 / 4)
```

The increase in growth units when reaching Power Level `PL` is `floor(PL / 2)`.

A Scaling power can use a power-specific base value and coefficient, for example:

```text
maxForce = baseForce + forceCoefficient * powerGrowthUnits(PL)
```

A bespoke monotonic formula is allowed when the phenomenon genuinely needs one, but it must be explicit and deterministic.

### Hybrid

A Hybrid power gains both depth and breadth.

- It receives continuous formula growth at every Power Level.
- It receives new functionality at **every prime-numbered Power Level**.
- Its continuous scaling is weaker than a comparable Scaling specialist.
- Its prime-level functionality is narrower/weaker than a comparable Milestone specialist.

Hybrid does not mean exactly 50% of each. Balance is qualitative and power-specific, but both compromises must be real.

## Power generation and balance rubric

Power generation is constrained creativity, not unrestricted narration and not a universal point-buy table.

Evaluate the power across:

- potency;
- reach/range;
- affected scope/target count;
- duration;
- precision/control;
- efficiency/cost;
- versatility/number of distinct applications;
- restrictions and prerequisites.

Manifestation Strength increases the total starting capability available across those dimensions.

Guidance:

- **Strength 1:** narrow personal/local effect, one clear supernatural principle, meaningful limits, and modest starting scope.
- **Strength 2:** clearly superhuman and able to overcome at least one serious mundane limitation reliably, or to add a second closely related capability dimension.
- **Strength 3:** strong enough to define an encounter or substantial practical problem through potency, scope, precision, efficiency, or another tightly related axis.
- **Strength 4+:** each additional step should materially improve one or more dimensions or permit another tightly related starting facet without abandoning the core principle.

Higher Manifestation Strength may make a starting power broader or more efficient, but does not grant arbitrary unrelated functions or automatically pre-unlock future prime-level milestone functions.

For profile balance:

- a Scaling specialist may concentrate most of its growth budget into one or two tightly coupled quantitative dimensions;
- a Milestone specialist may receive substantial new applications at prime levels while keeping raw numeric growth comparatively flat;
- a Hybrid should sit at least one qualitative step below a comparable Scaling specialist on its continuous-growth axis and should receive narrower/more conditional prime-level functions than a comparable Milestone specialist.

The validator need not calculate a universal "power score." The generation proposal must instead include a short structured balance rationale against these dimensions and profile constraints.

## Mana

Mana is a normal supernatural resource, not a mandatory cost for every power.

Maximum Mana is:

```text
maxMana = baseEndurance + baseCool
```

Use base Attribute values unless an explicit effect says that it modifies Mana capacity. Generic temporary Performance modifiers do not silently alter Max Mana.

Mana regenerates continuously in fictional time:

```text
manaPerSecond = maxMana / 600
```

An empty reserve therefore refills naturally in ten minutes.

Rules:

- `0 <= currentMana <= maxMana`;
- Mana may remain fractional internally;
- regeneration continues by default even during ordinary action;
- an ability may explicitly suppress or modify regeneration;
- sustained abilities may define an activation cost and/or Mana-per-second upkeep;
- if the character cannot pay a required cost, that effect cannot begin or continue;
- reaching 0 Mana has no universal extra penalty beyond being unable to pay additional Mana costs;
- when Max Mana rises because base Endurance/Cool rises, current Mana does not automatically refill; it simply gains additional empty capacity.

Presentation labels such as Low, Medium, or High Mana Cost may be derived for UI, but authoritative power mechanics store an exact number or formula.

## Other ability costs and limits

A power function may use zero or more explicit constraints:

- Mana;
- fictional activation time;
- maintained concentration/channeling;
- duration;
- range/reach;
- target eligibility;
- materials/consumables;
- Stress or other consequences;
- environmental conditions;
- charges;
- explicit recovery period when fiction genuinely requires one.

There is no universal videogame-style cooldown system. A power can have a recovery period, but cooldown is not assumed merely because an effect is strong.

Passive powers produce derived modifiers/effects. They do not silently rewrite the underlying base Attribute unless their mechanic explicitly performs an authoritative Attribute change.

## Fully specified reference power: Invincible

This is a first-slice reference specification inspired by Nathan's source power. It demonstrates a Scaling power with both passive and active functionality.

### Identity

- **Core principle:** the user's body becomes supernaturally resistant to physical harm and can briefly enter a state in which bodily injury cannot be inflicted.
- **Growth profile:** Scaling.
- **Manifestation Strength:** fixed at manifestation.
- **Prime Power Levels:** no automatic new functionality.

Let:

```text
CL = current Character Level
PL = current Power Level
M  = Manifestation Strength
G  = floor(PL^2 / 4)
```

### Passive: Reinforced Body

```text
durabilityBonus = floor(2 * CL + 2 * M + 3 * G)
strengthBonus   = floor(durabilityBonus / 2)
```

These are derived modifiers. They do not overwrite base Durability or Strength.

For a power manifested at Character Level 1, `M = 1`:

- CL1 / PL1 gives +4 Durability and +2 Strength;
- CL2 / PL2 gives +9 Durability and +4 Strength.

The latter preserves the source sheet's observed +9/+4 shape while fitting the new shared growth model.

### Active: Invincible State

- **Activation time:** 0.25 seconds.
- **Mana cost:** 25 Mana.
- **Duration:** `1 + M + G` seconds.
- **Target:** self.
- **Range:** self.
- **Concentration:** none.
- **Cooldown:** none.

While active:

- external physical force cannot inflict new Injury Stress on the user;
- external physical force cannot apply a bodily-damage Status whose only basis is injury to tissue/bone/organs;
- the effect does not prevent displacement, restraint, suffocation, Fear/Anger/Insecurity/Exhaustion, mind effects, social effects, or another explicitly non-injury consequence;
- a rules operation must classify the prevented consequence as physical bodily injury for the protection to apply.

The user still occupies space and can be pushed, trapped, buried, carried, or otherwise affected when the consequence is not bodily injury.

At M1/PL1 the active duration is 2 seconds. At M1/PL2 it is 3 seconds.

This ability is deterministic once activated. Any separate attempt to accomplish something while Invincible still uses the normal action-resolution rules.

## Advancement communication

Crossing a threshold always produces a player-facing progression report after the state commit. It should identify:

- new Character Level and XP state;
- universal Attribute increases;
- individualized Attribute allocations;
- level-up SP allocations;
- PP allocations and resulting Power Levels;
- newly manifested powers and their Manifestation Strength;
- any new prime-Power-Level functionality;
- changed Mana maximum when Endurance/Cool changed.

This report is presentation of authoritative state. It does not imply that the fictional character sees a game interface.

Awakening Earth characters may instead experience threshold growth as bodily, mental, or supernatural change and develop their own cultural vocabulary for it.

## Classes, rarity, and respec

- There is **no mechanical class system** in the reference ruleset. Occupation, profession, reputation, affiliation, and self-description belong to setting/world state.
- There is **no objective universal power-rarity or S-tier taxonomy** in this slice. Institutions may later invent fallible in-world ranking schemes.
- There is **no ordinary respec**. Advancement is historical. Retraining means actually developing different capabilities over time. An explicit supernatural mechanic may override this.

## Verification scenario

Assume an awakened Level-1 character has:

- 9 Character XP;
- one existing Scaling power, Invincible, manifested at Character Level 1 with `M = 1`;
- 5 PP invested in Invincible, so it is Power Level 1;
- Endurance 50 and Cool 50, so Max Mana is 100.

The character meaningfully participates in defeating a dangerous monster while also using Invincible under genuine pressure. The XP proposal records high Stretch, Stakes, Agency, and Magical Resonance plus meaningful power-use Growth. The current Level-1 span is `10 - 2 = 8 XP`; a Significant award can validly round to 1 XP.

After committing +1 XP, the character reaches 10 XP and crosses into Character Level 2.

Level 2 is prime, so:

1. a second power manifests at Manifestation Strength `1 + floor(2 / 2) = 2`;
2. every Attribute gains +1;
3. power count becomes 2;
4. cumulative discretionary Attribute entitlement becomes `floor(4*2 - 1.5*2) = 5`, so 5 Attribute Points are automatically distributed from development evidence;
5. 5 Skill Points are automatically distributed from learning/practice evidence;
6. total PP budget rises from `floor(5.5*1)=5` to `floor(6*2)=12`, creating 7 new PP;
7. 2 PP are reserved for the new power, making it Power Level 1;
8. the remaining 5 PP go to the previously existing Invincible power because its use/development evidence supports that allocation;
9. Invincible reaches 10 PP and therefore Power Level 2;
10. its passive changes from +4 Durability/+2 Strength at CL1/PL1 to +9 Durability/+4 Strength at CL2/PL2, and its active duration rises from 2 to 3 seconds;
11. if the individualized Attribute allocation puts, for example, +1 additional point into Cool, Endurance becomes 51 and Cool becomes 52 after universal/individual growth, raising Max Mana from 100 to 103 while current Mana remains unchanged until regeneration restores the new capacity;
12. the entire progression change commits atomically and is then shown to the player in an exact advancement report.

Nothing in the narration can skip these operations or directly declare the new level, points, power, or upgraded Invincible effects.

## First-slice state requirements

A first-slice actor progression representation must be able to preserve at least:

- Character XP and derived Level;
- starting/base Attributes;
- universal and discretionary Attribute advancement;
- skill SP plus use-based evidence and level-up allocations;
- bonus progression pools where explicitly granted;
- power definitions and current PP/Power Level;
- Character Level at manifestation and Manifestation Strength;
- growth profile and committed milestone functions;
- Mana current/max derivation;
- development evidence/provenance sufficient to audit automatic allocation;
- player-facing advancement event/result data.

The exact TypeScript/Zod implementation belongs to downstream integration/implementation work.

## Deferred

This design intentionally does not settle:

- a giant authored/generated power catalog;
- exact late-game balance at very high Character/Power Levels;
- universal institutional power rankings;
- respec systems beyond explicit exceptional mechanics;
- final character-sheet/progression UI;
- exhaustive generation templates for every conceivable supernatural effect;
- specialized power interactions that can be added as concrete powers require them.
