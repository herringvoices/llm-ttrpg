# Awakening Earth — Awakened Types and Practice-Based Progression (v2 design)

> **Status: proposed rules revision, not yet implemented in the TypeScript ruleset.** This is the design source for a future coordinated ruleset/adapter/validator migration. The v1 numerical rules still describe the running implementation until that work lands. Existing character saves must retain their established history and require an explicit versioned migration before adopting changed formulas.
>
> This document captures the Nov 2026 progression playtest decisions. Items labelled **Working calibration value** are testable defaults, not separately confirmed final balance numbers. Do not present an unimplemented design rule as already active in a campaign.

## Goals and agreed design constraints

1. The supernatural **Awakened type** determines *when additional powers appear* and how readily individual powers grow; it is not a conventional combat class and does not dictate which attributes, skills, or power domains a character can possess.
2. Every awakened character begins with their first power at Character Level 1. Prime, Periodic, and Fibonacci follow different later manifestation schedules.
3. **All Milestone and Hybrid powers gain new functions at Power Levels 5, 10, 15, 20, ...**, regardless of Awakened type. Scaling powers continue their numerical scaling without automatically gaining new functions. Discoveries may clarify an existing function without claiming an unearned milestone.
4. **Character XP and individual power PP have separate ledgers.** The *threshold curve* for Power Level must be changed from the original Slow cubic curve along with Character XP. Level-up PP is still multiplied by the number of manifested powers so versatility does not dilute the entire character's development pool.
5. Practicing an established skill or power is itself a legitimate source of Skill Points (SP) or Power Points (PP); uncertain checks, novelty, combat, and danger are **not prerequisites**. Repetition and long-duration grinding can improve mastery.
6. The average mundane human has **30 in each of the 18 attributes**. This is a human reference point, not a universal per-species average. A bear can have Strength 50 on the same raw scale. Attributes remain species-neutral in calculation, with anatomy, size, senses, and movement modeled by actual creature capabilities, traits, and feasibility.
7. Potential and Realized Effect can reach **5** rather than 3; stress tracks still take an actor out at 5, subject to their existing narrative meaning.
8. Attribute advancement must be more noticeable early, while Awakened type may influence the *distribution* of discretionary points. No type bars a character from developing any attribute.
9. No mandatory cooldown, artificial daily training ceiling, fatigue economy, or novelty tax is introduced merely to prohibit practice. Fictional time, credible practice, action pressure, and existing real constraints still apply.

## Three Awakened types

| Type | Additional power manifestations | PP-to-Power-Level curve | Starting potency | Progression identity |
| --- | --- | --- | --- | --- |
| **Prime** | Prime-numbered Character Levels: 2, 3, 5, 7, 11, 13, ... | **Slow** | Lower Manifestation Strength than equivalent Periodic/Fibonacci powers | Many comparatively weaker powers; slower to deepen each |
| **Periodic** | Every 5 Character Levels: 5, 10, 15, 20, ... | **Medium Fast** | Standard | Middle course between breadth and depth |
| **Fibonacci** | Widely spaced Fibonacci Character Levels: 8, 13, 21, 34, 55, 89, ... | **Fast** | Same standard as Periodic | Fewer powers, most PP available for mastery |

All types have one power at Level 1. Fibonacci deliberately skips early Fibonacci terms 2, 3, and 5 in this **working interpretation** to differentiate the specialist from Prime from the start; confirm in playtests rather than silently changing the schedule.

Illustrative power counts, **including** the first power:

| Character Level | Prime | Periodic | Fibonacci |
| ---: | ---: | ---: | ---: |
| 5 | 4 | 2 | 1 |
| 10 | 5 | 3 | 2 |
| 20 | 9 | 5 | 3 |
| 50 | 16 | 11 | 5 |

The type can be unknown to a newly awakened character. It is a real persisted mechanical fact, but its meaning need not be known to observers until development provides evidence.

### XP and PP threshold formulas

**Working calibration value:** Pokémon's Medium Fast group is the default proposed Character XP curve; Medium Slow remains an alternative until playtesting. This choice was a recommendation during discussion, not a separately confirmed vote.

- For new campaigns, Character Level 0 is XP 0. **Awakening into Level 1 remains at 2 XP** as a setting-specific exception; for Level `L >= 2`, use `characterXpThreshold(L) = L^3`.
- Prime power threshold: `PP(PL) = ceil(1.25 * PL^3)` (Slow).
- Periodic power threshold: `PP(PL) = PL^3` (Medium Fast).
- Fibonacci power threshold: `PP(PL) = ceil(0.8 * PL^3)` (Fast).
- Power Level derives from **the PP assigned to that individual power and its owner's type**, not from total Character XP and not from the total PP across all powers.
- A new power must begin at Power Level 1 with enough seed PP to reach the type-specific threshold. The existing fixed `2 PP` seed and `5 PP` first-awakening grant are legacy conventions and need careful review against these new curves.

| Target Power Level | Prime total PP | Periodic total PP | Fibonacci total PP |
| ---: | ---: | ---: | ---: |
| 2 | 10 | 8 | 7 |
| 5 | 157 | 125 | 100 |
| 10 | 1,250 | 1,000 | 800 |

The power function unlock schedule is separate from the curve: Level 5, 10, 15, ... of **that power**, not Character Level 5, 10, 15.

### Preserving the multiple-power allowance

Retain the rationale of the existing level-up PP budget:

```text
legacy cumulative level-up PP budget = floor((5 + 0.5 * numberOfPowers) * characterLevel)
```

The `0.5 * numberOfPowers` term exists **because characters with more powers need extra PP**. Do not remove it or replace it with a fixed shared pool. Redesign the full budget against the new type thresholds and include training-earned PP *outside* its cumulative cap.

**Working calibration question:** Fibonacci should earn the most PP for comparable investment, not merely have a cheaper Power-Level curve. Its type-specific PP multiplier/bonus (on practice and possibly on level-up grants) must be selected after progression simulations; it is not settled here. In particular, compare *total* PP and PP **per power** at Levels 5, 10, 20, 50, and 100. Prime's large power count increases its level-up grant via the existing allowance and may otherwise overtake Fibonacci's total pool at high levels.

The number-of-powers bonus also applies to Prime, but it does not compensate for weaker initial powers and slower per-power advancement automatically; these are independent balancing levers.

### Manifestation Strength

Retain **Manifestation Strength** (the initial potency and scope of a new power) as distinct from **Power Level** (earned mastery).

- Periodic and Fibonacci have identical standard Manifestation Strength at the same manifestation Character Level.
- Prime gets a weaker initial manifestation at the equivalent level; dedicated training must still allow any Prime power to grow.
- **Working calibration value, not final:** `standardStrength = 1 + floor(levelAtManifestation / 2)`; `primeStrength = max(1, standardStrength - 1)`.
- Never silently weaken an already manifested power on an existing save. No universal upper ceiling on Prime Power Level.

## Genuine practice: Skill SP and individual Power PP

**Agreed rule:** ordinary deliberate practice, repetitive drills, exercises with powers, sustained use, guided study, and actual use in the world can all develop the relevant competency even when there is no meaningful uncertainty. Experimentation and risky challenges may still provide additional learning, but novelty is not a prerequisite.

A valid training award has an established character, an existing skill/power or justified emergent skill, a stated focus, actual fictional duration, and plausible means to practice. Awards follow the capability practiced. One long montage can resolve and award training for its real elapsed time; it need not trigger hundreds of invented rolls. In high Action Pressure, stop at the currently allowed horizon or an actual interruption. Do not grant the same minutes of practice twice.

**Working calibration values (to be tested, not yet authoritative):**

- Skill drills: 1 SP per actual hour of focused practice; accumulate fractional SP for shorter sessions. This adds to, rather than replaces, ordinary SP from uncertain checks or level-up allocations.
- Per-power drills: Periodic earns 1 PP per practice hour, Prime 0.5 PP/hour, Fibonacci 2 PP/hour; retain fractional *unbanked training progress* until a whole PP can be committed, because current power state stores integer PP.
- Real-world power use outside a dedicated training session should also be eligible for earned PP, with rate/amount justified by the actual scale of activity. Do not award both full-session practice and a duplicate power-use award for precisely the same effort.
- Character XP from substantial practice remains permissible after Awakening, not just from monsters or discoveries. Character XP uses its own award rules rather than directly copying all SP or PP.
- Successful and failed uncertain skill checks continue granting ordinary use-based SP. Extend the Effect 4–5 award table proportionally if that table is retained (failure `0.25 * Potential Effect`; success `0.5 * Potential Effect`).
- No novelty decay to zero: ordinary repeated training continues producing progress. There is no automatic additional penalty or fatigue mechanic from training itself.

Numbers and implementation of practice awards require tests against a six-month training-only character, a six-month monster hunter, and a mixed character. Existing practical constraints (where/how the power is usable, instruction, circumstances, real time, and active developments) still matter.

## Attributes, standardized Resistance, and creature differences

Human baseline is 30 **in each Attribute** before individual biography/evidence is applied. The starting-human total should consequently be centered at `18 * 30 = 540`, replacing the old 972–1118 validation range after migration. The exact permitted starting variance remains a calibration task; don't mechanically flatten everyone to identical 30s.

The common numerical attribute scale applies to humans, animals, monsters, and other actors. It is **not** species-normalized: a bear's 50 Strength is stronger on the same scale than an average human's 30 Strength. Anatomical feasibility, movement, size, reach, protection, and supernatural resistance still matter. A human-origin attribute-vision ability may present 30 as its reference point because it is calibrated to humans; that presentation does not change the underlying species-neutral attributes.

Resistance should use explicit numerical benchmarks calibrated around 30, while still considering trained skill contribution, circumstances, and action feasibility. Recalibrate the current `ordinary=55, obstructed=65` fallback constants; do not carry them into the 30-baseline unchanged. Exact benchmark tiers and hit probabilities should be tested using the existing two-d16 ±15% variance.

Attribute increases at new Character Levels must be larger and more noticeable than the current `floor(L/2)` universal growth alone. **The specific increase is not yet agreed**; a trial candidate is `1 + floor(L/2)` to every attribute at threshold L, to be tested with the new baseline and Resistance bands. Prime should *tend* to spread discretionary points broadly, Periodic should distribute them in a balanced way, and Fibonacci should *tend* toward concentration; total entitlement should remain comparable unless balance tests demonstrate a reason otherwise. Character actions and training remain the evidence for which attributes improve, regardless of type.

## Effect 1–5

- Effect is an integer **1, 2, 3, 4, or 5** before resolution, and realized Effect may be **0–5**.
- Fixed, contextual, and derived Effect modes can realize any amount up to the authorized Potential Effect.
- The five established stress tracks still take an actor out at track value 5; Effect 5 can therefore take out an ordinary vulnerable target in one consequential action. Taken Out is not automatically death.
- **Working calibration** for independently checked Effect: `R`, `1.15R`, `1.30R`, `1.45R`, `1.60R` (five thresholds). This requires simultaneous updates to schema, effect checking, explanation, awards, tests, and encounter threat calibration. More powerful effects must be supported by actual method/ability, not awarded solely for a lucky accuracy roll.

## Integration and acceptance criteria

Implementation requires one coordinated migration rather than changing only formulas in a document. At minimum:

1. Add persisted Awakened type for awakened humans; allow it to be narratively undiscovered; do not assign it to unawakened humans by accident.
2. Implement and test Character XP thresholds, each type's Power Level thresholds, the separate cumulative PP budget (including power-count allowance), PP earned independently through use/training, and correct seed PP.
3. Generate powers at each type's schedule and functions every five *Power Levels* for Milestone/Hybrid; compare numeric growth against the fixed legacy assumptions.
4. Implement a deterministic authoritative training operation or equivalent validated action-resolution path with elapsed time, explicit award evidence, and fractional carry where necessary. Keep independent character XP, skill SP, and per-power PP ledgers. Training should not require an uncertain die roll.
5. Recenter mundane human creation, evidence generation, benchmarks, and attribute-vision presentation around 30 while preserving creature attributes on the same numeric scale.
6. Extend all Effect and SP schemas, checked Effect thresholds, stress handling, encounter prep, and tests to Effect 5. Existing stress and PC-fatal-consent protections must remain.
7. Update power-generation prompts, exemplar validation (including Invincible), opening-awakening validation, reference fixtures, affected tests, and user-facing docs. Ensure no old `prime` ability-function logic survives.
8. Maintain explicit v1/v2 ruleset versions or migration steps. Old saves remain authoritative and must not be implicitly rewritten.
9. Add progression simulation tests (six months of practice, hunting, and mixed play) for every type, including comparisons of PP earned *per power* and in total.

## What is settled vs. still to tune

**Settled:** three type identities; Prime/five-level/Fibonacci manifestation concept; weaker Prime power manifestation; equal Periodic/Fibonacci manifestation strength; five-Power-Level function milestones; practice-based SP and PP; retained extra PP allowance for owning more powers; 30-human attribute reference on a shared scale; larger attribute growth; Effect up to 5; no invented fatigue or practice cooldown system.

**Still tuning:** final Character XP Medium Fast vs Medium Slow choice; whether Fibonacci starts extra manifestations at 8 or retains 2/3/5; exact attribute increase; final Prime potency reduction; level-up PP budget and Fibonacci multiplier; exact practice rates and character XP from repeated training; fixed Resistance benchmarks. Defaults above are expressly **proposals**, not retrospective facts or a claim that the code already implements them.
