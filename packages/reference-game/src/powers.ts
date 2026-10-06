import { z } from "zod";
import { stableIdSchema } from "@llm-ttrpg/engine";
import { invinciblePower } from "./ruleset/invincible.js";
import {
  powerStateSchema,
  powerTagSchema,
  type PowerState,
} from "./ruleset/model.js";

function authoredPower(value: unknown): PowerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return powerStateSchema.parse(value);
  }
  return powerStateSchema.parse({
    discoveredBehaviors: [],
    committedMilestones: [],
    ...value,
  });
}

/**
 * A starter vocabulary for Awakening Earth retrieval. It is deliberately open:
 * generated powers may introduce new tags without changing this list.
 */
export const awakeningEarthPowerTagVocabulary: readonly string[] = Object.freeze([
  "domain.body",
  "domain.electricity",
  "domain.fire",
  "domain.force",
  "domain.gravity",
  "domain.information",
  "domain.progression",
  "domain.space",
  "domain.technology",
  "operation.alter",
  "operation.copy",
  "operation.create",
  "operation.grant",
  "operation.project",
  "operation.reinforce",
  "operation.sense",
  "operation.store",
  "operation.transfer",
  "target.area",
  "target.creature",
  "target.information",
  "target.object",
  "target.self",
  "shape.active",
  "shape.passive",
  "shape.sustained",
  "shape.touch",
  "role.defense",
  "role.enhancement",
  "role.information",
  "role.melee",
  "role.mobility",
  "role.offense",
  "role.resource",
  "role.stat-enhancement",
  "role.support",
  "role.utility",
].map((tag) => powerTagSchema.parse(tag)));

export const questPower = authoredPower({
  id: "power.quest",
  name: "Quest",
  corePrinciple:
    "The user receives contextual supernatural objectives whose completion can produce proportionate rewards.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "milestone",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.quest.issue",
    name: "Quest",
    description:
      "Present a grounded objective tied to something the user could meaningfully do and establish its rewards.",
    manaCost: 0,
    activationTimeMs: 0,
    conditions: ["a meaningful objective is available in the user's circumstances"],
    targets: ["self"],
    limits: [
      "does not force the user to accept or complete a quest",
      "rewards must remain proportionate to difficulty and current power capability",
    ],
  }],
  developmentAxes: ["quest complexity", "reward breadth", "participant rewards"],
  tags: [
    "domain.progression",
    "operation.create",
    "target.self",
    "shape.passive",
    "role.resource",
    "role.utility",
  ],
  balanceRationale:
    "Quest is broad in consequence but indirect: it creates opportunities and rewards rather than directly solving the objective.",
});

export const helpPower = authoredPower({
  id: "power.help",
  name: "Help",
  corePrinciple:
    "Touching a target allows the user to perceive truthful structured information about that target.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "hybrid",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.help.inspect",
    name: "Help",
    description: "Reveal grounded information about a touched target.",
    manaCost: 0,
    activationTimeMs: 0,
    conditions: ["the user is touching the target"],
    targets: ["one touched creature or object"],
    limits: [
      "information is limited by the power's current depth and what is objectively true",
      "the power does not itself change the target",
    ],
  }],
  developmentAxes: ["information depth", "retained displays", "target flexibility"],
  tags: [
    "domain.information",
    "operation.sense",
    "target.information",
    "target.object",
    "target.creature",
    "shape.touch",
    "role.information",
    "role.utility",
  ],
  balanceRationale:
    "Help can reveal unusually valuable information, but begins touch-bound and provides knowledge rather than direct physical control.",
});

export const inventoryPower = authoredPower({
  id: "power.inventory",
  name: "Inventory",
  corePrinciple:
    "The user can store and retrieve non-living objects in a personal pocket dimension.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "hybrid",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.inventory.store",
    name: "Inventory",
    description: "Store or retrieve a specifically intended non-living object.",
    manaCost: 0,
    activationTimeMs: 0,
    conditions: ["the user can identify the intended object"],
    targets: ["one non-living object"],
    limits: [
      "maximum mass per object is (Power Level * Self-Awareness + Strength) kilograms under normal Earth gravity",
      "range begins at immediate bodily contact",
    ],
    scalingFormula:
      "maxObjectMassKg=PowerLevel*SelfAwareness+Strength",
  }],
  developmentAxes: ["per-object mass", "interaction range", "target precision"],
  tags: [
    "domain.space",
    "operation.store",
    "target.object",
    "shape.active",
    "role.utility",
  ],
  balanceRationale:
    "Storage volume is extraordinary, but each object has a bounded mass and initial use requires close interaction and precise intent.",
});

export const fastTravelPower = authoredPower({
  id: "power.fast-travel",
  name: "Fast Travel",
  corePrinciple:
    "The user can draw one linked pair of portals on solid surfaces so overlapping portal area connects the two locations.",
  characterLevelAtManifestation: 5,
  manifestationStrength: 3,
  growthProfile: "hybrid",
  pp: 2,
  powerLevel: 1,
  functions: [{
    id: "power-function.fast-travel.portal-pair",
    name: "Portal Pair",
    description: "Paint and maintain one linked pair of traversable portals.",
    manaCost: 20,
    activationTimeMs: 1000,
    conditions: [
      "each portal must be physically drawn on a solid surface with the user's index finger",
    ],
    targets: ["two solid surfaces"],
    limits: [
      "only one linked pair may exist at once",
      "only overlapping portal area is traversable",
      "closing a portal cannot bisect matter",
    ],
    scalingFormula: "creationManaCost=20+portalAreaSquareMeters*5",
  }],
  developmentAxes: ["portal size", "creation efficiency", "placement flexibility"],
  tags: [
    "domain.space",
    "operation.create",
    "target.area",
    "shape.active",
    "role.mobility",
    "role.utility",
  ],
  balanceRationale:
    "The spatial effect is powerful but requires physical placement, a single pair, setup time, and a meaningful creation cost.",
});

export const shockCloakPower = authoredPower({
  id: "power.shock-cloak",
  name: "Shock Cloak",
  corePrinciple:
    "The user's body can discharge supernatural electricity into creatures that make physical contact with them.",
  characterLevelAtManifestation: 2,
  manifestationStrength: 2,
  growthProfile: "scaling",
  pp: 2,
  powerLevel: 1,
  functions: [{
    id: "power-function.shock-cloak.discharge",
    name: "Shock Cloak",
    description: "Electrically shock a creature in direct physical contact with the user.",
    manaCost: 5,
    activationTimeMs: 0,
    conditions: ["the target is physically touching the user"],
    targets: ["one touching creature"],
    limits: ["contact-bound", "does not project electricity at range"],
    scalingFormula: "effectStrength=ManifestationStrength+PowerLevel",
  }],
  developmentAxes: ["discharge strength", "contact coverage", "efficiency"],
  tags: [
    "domain.electricity",
    "operation.transfer",
    "target.creature",
    "shape.active",
    "role.defense",
    "role.offense",
  ],
  balanceRationale:
    "The power gains strong close-range value but cannot initially reach targets that avoid contact.",
});

export const flamingFistPower = authoredPower({
  id: "power.flaming-fist",
  name: "Flaming Fist",
  corePrinciple:
    "The user can wrap their hands in controlled supernatural flame that does not burn them.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "scaling",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.flaming-fist.ignite",
    name: "Flaming Fist",
    description: "Surround the user's hands with controlled flame for close-range use.",
    manaCost: 2,
    activationTimeMs: 100,
    conditions: ["the user's hands are free enough to manifest flame"],
    targets: ["self"],
    limits: ["flame initially remains close to the hands", "does not grant broad fire immunity"],
    scalingFormula: "flameIntensity=ManifestationStrength+PowerLevel",
  }],
  developmentAxes: ["flame intensity", "control", "sustained efficiency"],
  tags: [
    "domain.fire",
    "operation.create",
    "target.self",
    "shape.sustained",
    "role.melee",
    "role.offense",
  ],
  balanceRationale:
    "A direct and useful combat power whose starting reach remains melee-scale.",
});

export const combustionPower = authoredPower({
  id: "power.combustion",
  name: "Combustion",
  corePrinciple:
    "The user can create directed explosions from their body to propel themselves and strike nearby targets.",
  characterLevelAtManifestation: 2,
  manifestationStrength: 2,
  growthProfile: "scaling",
  pp: 2,
  powerLevel: 1,
  functions: [{
    id: "power-function.combustion.burst",
    name: "Combustion Burst",
    description: "Create a directed explosive burst for propulsion or close-range force.",
    manaCost: 8,
    activationTimeMs: 100,
    conditions: ["the user can safely choose a direction for the burst"],
    targets: ["self or a nearby target"],
    limits: ["recoil and collision consequences still matter", "short initial burst"],
    scalingFormula: "burstStrength=2*ManifestationStrength+PowerLevel",
  }],
  developmentAxes: ["burst force", "directional control", "efficiency"],
  tags: [
    "domain.fire",
    "domain.force",
    "operation.create",
    "target.self",
    "target.creature",
    "shape.active",
    "role.mobility",
    "role.offense",
  ],
  balanceRationale:
    "Combustion combines movement and offense, but the same force that moves the user creates positioning and collision risks.",
});

export const heatRisingPower = authoredPower({
  id: "power.heat-rising",
  name: "Heat Rising",
  corePrinciple:
    "The user can reduce gravity's effect on their own body.",
  characterLevelAtManifestation: 3,
  manifestationStrength: 2,
  growthProfile: "scaling",
  pp: 2,
  powerLevel: 1,
  functions: [{
    id: "power-function.heat-rising.lighten",
    name: "Heat Rising",
    description: "Reduce the effective gravitational pull on the user's body.",
    manaCost: 3,
    activationTimeMs: 0,
    conditions: ["self only"],
    targets: ["self"],
    limits: ["does not itself provide propulsion", "does not alter gravity for carried surroundings"],
    scalingFormula:
      "gravityMultiplier=max(0.1,1-0.15*(ManifestationStrength+PowerLevel))",
  }],
  developmentAxes: ["gravity reduction", "control", "efficiency"],
  tags: [
    "domain.gravity",
    "operation.alter",
    "target.self",
    "shape.sustained",
    "role.mobility",
    "role.utility",
  ],
  balanceRationale:
    "The power is intentionally modest alone: it changes the user's gravity but supplies no independent thrust or attack.",
});

export const predatorBlessingPower = authoredPower({
  id: "power.predator-blessing",
  name: "Predator (Blessing)",
  corePrinciple:
    "The user can grant a predatory physical blessing that enhances a recipient and routes part of that recipient's earned supernatural growth back to the grantor.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "hybrid",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.predator-blessing.grant",
    name: "Predator Blessing",
    description: "Grant a recipient enhanced physical capability and retractable claws.",
    manaCost: 20,
    activationTimeMs: 1000,
    conditions: ["the recipient accepts or is otherwise valid for the blessing"],
    targets: ["one creature"],
    limits: [
      "the granted package is narrower than the grantor's full power",
      "half of supernatural experience earned through the blessing routes to the grantor",
    ],
  }],
  developmentAxes: ["recipient count", "enhancement breadth", "grant efficiency"],
  tags: [
    "domain.progression",
    "domain.body",
    "operation.grant",
    "target.creature",
    "shape.active",
    "role.enhancement",
    "role.support",
    "role.resource",
  ],
  balanceRationale:
    "The blessing can scale socially through recipients, but its direct grant is bounded and its growth-routing rule creates dependence and consequences.",
});

export const switchPower = authoredPower({
  id: "power.switch",
  name: "Switch",
  corePrinciple:
    "The user can turn electronic devices on or off and temporarily supply power to an otherwise unpowered device.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "hybrid",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.switch.toggle",
    name: "Switch",
    description: "Toggle a nearby electronic device and briefly power it when no ordinary source is available.",
    manaCost: 2,
    activationTimeMs: 0,
    conditions: ["the user can identify the target electronic device"],
    targets: ["one electronic device"],
    limits: ["does not rewrite software or control the device beyond ordinary on/off behavior"],
    scalingFormula: "temporaryPowerSeconds=5*PowerLevel",
  }],
  developmentAxes: ["range", "temporary power duration", "target complexity"],
  tags: [
    "domain.technology",
    "operation.alter",
    "target.object",
    "shape.active",
    "role.utility",
  ],
  balanceRationale:
    "Switch is highly practical but begins with a narrow on/off and temporary-power relationship to electronics.",
});

export const eyeForceBeamPower = authoredPower({
  id: "power.eye-force-beam",
  name: "Eye Force Beam",
  corePrinciple:
    "The user projects a narrow beam of supernatural force along their line of sight.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "scaling",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.eye-force-beam.fire",
    name: "Force Beam",
    description: "Project a narrow concussive beam toward a visible target.",
    manaCost: 5,
    activationTimeMs: 100,
    conditions: ["the user can see the target"],
    targets: ["one visible target"],
    limits: ["primarily force rather than heat", "requires line of sight"],
    scalingFormula: "beamForce=ManifestationStrength+2*PowerLevel",
  }],
  developmentAxes: ["force", "range", "precision"],
  tags: [
    "domain.force",
    "operation.project",
    "target.creature",
    "target.object",
    "shape.active",
    "role.offense",
  ],
  balanceRationale:
    "A deliberately straightforward ranged attack with clear targeting and resource constraints.",
});

export const copyPastePower = authoredPower({
  id: "power.copy-paste",
  name: "Copy/Paste",
  corePrinciple:
    "The user can copy eligible physical targets into a supernatural clipboard and paste temporary duplicates subject to an active duplicate-mass budget.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "hybrid",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.copy-paste.object",
    name: "Copy/Paste Object",
    description:
      "Copy one liftable non-living object into the Level-1 clipboard slot and paste duplicates of it.",
    manaCost: 0,
    activationTimeMs: 0,
    conditions: [
      "the copied target is non-living",
      "the user can lift the original object",
    ],
    targets: ["one non-living object"],
    limits: [
      "maximum copied-object mass is user mass multiplied by Power Level",
      "total active duplicate mass cannot exceed user mass multiplied by Power Level",
      "copying a new target into an occupied slot replaces that slot without dismissing existing duplicates",
      "pasted duplicates may be dismissed at will",
      "one clipboard slot at Power Level 1",
    ],
    scalingFormula:
      "maxCopiedObjectMass=userMass*PowerLevel; maxActiveDuplicateMass=userMass*PowerLevel; clipboardSlots=1+count(prime Power Levels from 2 through current Power Level)",
  }],
  developmentAxes: [
    "active duplicate mass",
    "clipboard slots",
    "duplicate lifecycle accounting",
    "target eligibility",
  ],
  tags: [
    "operation.copy",
    "operation.create",
    "target.object",
    "shape.active",
    "role.utility",
    "role.resource",
  ],
  balanceRationale:
    "The rule is broad in possible applications but starts with liftable non-living targets, one clipboard slot, and a body-mass-based active duplicate budget.",
});

export const quickChangePower = authoredPower({
  id: "power.quick-change",
  name: "Quick Change",
  corePrinciple:
    "While holding their breath, the user can change their own mass without directly changing their body's volume.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "scaling",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.quick-change.mass",
    name: "Quick Change",
    description: "Increase or decrease the user's mass while they continue holding their breath.",
    manaCost: 0,
    activationTimeMs: 0,
    conditions: ["the user is voluntarily holding their breath"],
    targets: ["self"],
    limits: [
      "the effect ends when the user resumes breathing",
      "Level-1 mass is bounded between 85% and 150% of ordinary mass",
    ],
    scalingFormula:
      "minMassMultiplier=max(0.1,1-0.15*PowerLevel); maxMassMultiplier=1+0.5*PowerLevel",
  }],
  developmentAxes: ["minimum mass", "maximum mass", "rate of change", "breath restriction"],
  tags: [
    "domain.body",
    "operation.alter",
    "target.self",
    "shape.sustained",
    "role.mobility",
    "role.utility",
  ],
  balanceRationale:
    "Mass manipulation has broad physical implications, but Level 1 is self-only, bounded, and limited by breath duration.",
});

export const strengthEnhancementPower = authoredPower({
  id: "power.strong",
  name: "Strong",
  corePrinciple: "The user's physical strength is supernaturally increased.",
  characterLevelAtManifestation: 2,
  manifestationStrength: 2,
  growthProfile: "scaling",
  pp: 2,
  powerLevel: 1,
  functions: [{
    id: "power-function.strong.passive",
    name: "Strong",
    description: "Passively increase effective Strength.",
    manaCost: 0,
    activationTimeMs: 0,
    conditions: ["the power is manifested"],
    targets: ["self"],
    limits: ["changes effective capability rather than rewriting the base Strength attribute"],
    scalingFormula: "strengthBonus=2*ManifestationStrength+2*PowerLevel",
  }],
  developmentAxes: ["strength bonus"],
  tags: [
    "domain.body",
    "operation.reinforce",
    "target.self",
    "shape.passive",
    "role.enhancement",
    "role.stat-enhancement",
  ],
  balanceRationale:
    "This is intentionally plain: it spends nearly all of its identity and growth budget on one stat-like physical enhancement.",
});

export const forceBoltPower = authoredPower({
  id: "power.force-bolt",
  name: "Force Bolt",
  corePrinciple: "The user can launch a compact burst of supernatural concussive force.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "scaling",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.force-bolt.fire",
    name: "Force Bolt",
    description: "Fire a compact concussive projectile at a target.",
    manaCost: 4,
    activationTimeMs: 100,
    conditions: ["the user can aim toward the target"],
    targets: ["one target"],
    limits: ["single target", "no fine telekinetic control"],
    scalingFormula: "boltForce=ManifestationStrength+2*PowerLevel",
  }],
  developmentAxes: ["force", "range", "accuracy", "efficiency"],
  tags: [
    "domain.force",
    "operation.project",
    "target.creature",
    "target.object",
    "shape.active",
    "role.offense",
  ],
  balanceRationale:
    "A simple ranged attack intended to prove that valid powers do not need conceptual complexity.",
});

export const impactPower = authoredPower({
  id: "power.impact",
  name: "Impact",
  corePrinciple:
    "When the user makes a deliberate melee strike, they can add a short supernatural burst of kinetic force at contact.",
  characterLevelAtManifestation: 1,
  manifestationStrength: 1,
  growthProfile: "scaling",
  pp: 5,
  powerLevel: 1,
  functions: [{
    id: "power-function.impact.strike",
    name: "Impact",
    description: "Add concussive force to a deliberate close-range strike.",
    manaCost: 3,
    activationTimeMs: 0,
    conditions: ["the user makes deliberate physical contact as part of a strike"],
    targets: ["one touched target"],
    limits: ["melee/contact range", "does not improve unrelated movement or lifting"],
    scalingFormula: "addedImpact=ManifestationStrength+2*PowerLevel",
  }],
  developmentAxes: ["impact force", "efficiency", "contact flexibility"],
  tags: [
    "domain.force",
    "operation.transfer",
    "target.creature",
    "target.object",
    "shape.touch",
    "role.melee",
    "role.offense",
  ],
  balanceRationale:
    "A straightforward melee enhancement with no ranged or general-purpose telekinetic component.",
});

export const awakeningEarthPowerExemplars: readonly PowerState[] = Object.freeze([
  questPower,
  helpPower,
  inventoryPower,
  invinciblePower,
  flamingFistPower,
  forceBoltPower,
  impactPower,
  shockCloakPower,
  combustionPower,
  heatRisingPower,
  switchPower,
  eyeForceBeamPower,
  copyPastePower,
  quickChangePower,
  predatorBlessingPower,
  strengthEnhancementPower,
  fastTravelPower,
]);

export const powerExemplarQuerySchema = z.object({
  tags: z.array(powerTagSchema).default([]),
  text: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(20).default(5),
  excludePowerIds: z.array(stableIdSchema).default([]),
}).strict();

function searchablePowerText(power: PowerState): string {
  return [
    power.name,
    power.corePrinciple,
    ...power.tags,
    ...power.developmentAxes,
    ...power.functions.flatMap((fn) => [
      fn.name,
      fn.description,
      ...fn.conditions,
      ...fn.targets,
      ...fn.limits,
    ]),
  ].join(" ").toLocaleLowerCase();
}

export function retrievePowerExemplars(
  queryValue: unknown,
  catalog: readonly PowerState[] = awakeningEarthPowerExemplars,
): PowerState[] {
  const query = powerExemplarQuerySchema.parse(queryValue);
  const excluded = new Set(query.excludePowerIds);
  const wantedTags = new Set(query.tags);
  const terms = (query.text ?? "")
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length >= 3);
  const emptyQuery = wantedTags.size === 0 && terms.length === 0;

  return catalog
    .map((power, index) => {
      const tagMatches = power.tags.reduce(
        (count, tag) => count + (wantedTags.has(tag) ? 1 : 0),
        0,
      );
      const haystack = searchablePowerText(power);
      const textMatches = terms.reduce(
        (count, term) => count + (haystack.includes(term) ? 1 : 0),
        0,
      );
      return { power, index, score: tagMatches * 10 + textMatches };
    })
    .filter(({ power, score }) =>
      !excluded.has(power.id) && (emptyQuery || score > 0)
    )
    .sort((left, right) =>
      right.score - left.score || left.index - right.index
    )
    .slice(0, query.limit)
    .map(({ power }) => power);
}

export function relatedPowerExemplars(
  power: PowerState,
  limit = 5,
  catalog: readonly PowerState[] = awakeningEarthPowerExemplars,
): PowerState[] {
  return retrievePowerExemplars({
    tags: power.tags,
    text: [power.corePrinciple, ...power.developmentAxes].join(" "),
    limit,
    excludePowerIds: [power.id],
  }, catalog);
}
