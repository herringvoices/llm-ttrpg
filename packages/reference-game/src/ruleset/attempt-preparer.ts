import {
  type ActionAttemptPreparer,
  type PreparedActionAttempt,
  type SemanticActionAttempt,
} from "@llm-ttrpg/engine";
import { resolveActionInputSchema, type ResolveActionInput } from "./action-operation.js";
import { performancePlanSchema, type PerformancePlan } from "./mechanics.js";
import {
  rulesEntityStateSchema,
  type AttributeId,
  type RulesEntityState,
} from "./model.js";

/**
 * Reference-rules benchmarks. These are explicit package policy, never model-
 * authored difficulty numbers. An authored numeric target resistance overrides
 * the standard fallback when the source is valid.
 *
 * Action mode -> attribute(s):
 * attack: agility + strength; movement: agility + endurance;
 * manipulation: strength + fine-motor-skills; observation: perception + focus;
 * communication: presence + social-fluency; recovery: endurance + focus;
 * interaction/other: improvisation + focus.
 *
 * No situational modifier or helper is ever inferred without authoritative
 * evidence. The engine's existing stress/status calculation still applies.
 */
export const ATTEMPT_BENCHMARKS = Object.freeze({
  ordinary: 55,
  obstructed: 65,
  potentialEffect: 1 as const,
  combatPotentialEffect: 2 as const,
  defaultMaterialTimeMs: 1_000,
});

function stateOf(mechanics: unknown): RulesEntityState | undefined {
  const parsed = rulesEntityStateSchema.safeParse(mechanics);
  return parsed.success ? parsed.data : undefined;
}

function chooseAttributes(attempt: SemanticActionAttempt): AttributeId[] {
  const modes = new Set(attempt.modes);
  if (modes.has("attack")) return ["agility", "strength"];
  if (modes.has("movement")) return ["agility", "endurance"];
  if (modes.has("manipulation")) return ["strength", "fine-motor-skills"];
  if (modes.has("observation")) return ["perception", "focus"];
  if (modes.has("communication")) return ["presence", "social-fluency"];
  if (modes.has("recovery")) return ["endurance", "focus"];
  return ["improvisation", "focus"];
}

function knownSkills(
  actor: RulesEntityState,
  attempt: SemanticActionAttempt,
): string[] {
  const described = [attempt.declaration, attempt.goal, ...attempt.statedMeans]
    .join(" ").toLowerCase();
  const words = new Set(described.match(/[a-z]{4,}/g) ?? []);
  const combat = attempt.modes.includes("attack");
  return actor.skills.filter((skill) => {
    const wordsInName = skill.name.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    if (wordsInName.some((word) => words.has(word))) return true;
    // Grounded broad fighting expertise applies to explicit attack modes.
    if (combat && /\bfight(?:ing)?\b/i.test(skill.name)) return true;
    return false;
  }).map((skill) => skill.id).sort();
}

function plan(
  actor: RulesEntityState,
  attempt: SemanticActionAttempt,
  attributes = chooseAttributes(attempt),
): PerformancePlan {
  return performancePlanSchema.parse({
    attributeIds: attributes,
    applicableSkillIds: knownSkills(actor, attempt),
    attributeModifiers: [],
    performanceModifiers: [],
    helpers: [],
    maxUsefulHelpers: 0,
    combinedAttributeContributions: [],
  });
}

function missing(required: string[], reason: string): PreparedActionAttempt {
  return { status: "missing-required-data", required, reason };
}

/**
 * Called only by the trusted engine, after LM-03 has already authorized
 * references. Every numeric input is sourced from existing mechanics, an
 * authored target resistance, or the named reference-rules benchmark.
 */
export const prepareReferenceActionAttempt: ActionAttemptPreparer = ({
  operationId, attempt, world,
}) => {
  if (operationId !== "rules.actions.resolve-action") {
    return { status: "not-applicable" };
  }

  const actor = world.entities.find((entry) => entry.id === attempt.actorId);
  if (!actor) return { status: "cannot-attempt", reason: "The acting character no longer exists." };
  const actorMechanics = stateOf(actor.data.mechanics);
  if (!actorMechanics) {
    return missing([ `entity:${attempt.actorId}:mechanics` ],
      "Actor attributes, stress, skills and statuses must be realized before resolving this check.");
  }
  if (attempt.remainingHorizonMs === 0) {
    return { status: "cannot-attempt", reason: "Action Pressure permits no remaining fictional time for this attempt." };
  }

  const targetId = attempt.targetIds.find((id) => id !== attempt.actorId);
  const target = targetId ? world.entities.find((entry) => entry.id === targetId) : undefined;
  if (targetId && !target) {
    return { status: "cannot-attempt", reason: "The intended target is not present in the authoritative world." };
  }
  // This generic mechanical check cannot activate, expend, or extend powers.
  // Only a registered power operation with its own costs/range may do that.
  if (attempt.modes.includes("power-use")) {
    return { status: "cannot-attempt", reason: "Power activation requires a registered handler that enforces the power's established functions, costs and reach." };
  }

  const means = attempt.statedMeans.map((value) => value.trim().toLowerCase());
  // Do not conjure explicitly required implements. The ruleset will support
  // inventory-verified tools when the package has an inventory contract.
  const claimedImplement = means.map((value) =>
    value.match(/\b(?:crowbar|torch|knife|sword|gun|hammer)\b/i)?.[0]
  ).find((value): value is string => Boolean(value));
  if (claimedImplement) {
    const holdings = [
      actor.data.inventory, actor.data.equipment, actor.data.heldItems,
    ].flatMap((value) => Array.isArray(value) ? value :
      typeof value === "string" ? [value] : []);
    const held = holdings.some((value) =>
      typeof value === "string" && value.toLowerCase().includes(claimedImplement));
    if (!held) {
      return { status: "cannot-attempt",
        reason: `The declared implement "${claimedImplement}" is not established as available to the actor.` };
    }
  }

  const selectedPlan = plan(actorMechanics, attempt);
  const targetMechanics = target && stateOf(target.data.mechanics);
  const inContest = attempt.modes.includes("attack") &&
    (target?.kind === "actor" || target?.kind === "creature");
  if (inContest && !targetMechanics) {
    return missing([ `entity:${targetId}:mechanics` ],
      "An opposed attack needs the target's realized attributes and protective statuses.");
  }

  let resistance: ResolveActionInput["resistance"];
  let resistanceReason: string;
  if (inContest && targetMechanics && targetId) {
    resistance = {
      kind: "opposed",
      actorId: targetId,
      performance: plan(targetMechanics, { ...attempt, modes: ["observation"] }, ["agility", "perception"]),
    };
    resistanceReason = "Target's already-realized agility/perception and established statuses";
  } else {
    const explicitResistance = target
      ? world.facts.find((fact) =>
          fact.subjectId === target.id &&
          fact.predicate === "rules.action-resistance" &&
          typeof fact.value === "number" &&
          Number.isFinite(fact.value) && fact.value >= 0)
      : undefined;
    const numeric = explicitResistance ? Number(explicitResistance.value) :
      ATTEMPT_BENCHMARKS.ordinary;
    resistanceReason = explicitResistance
      ? "Authored fixed resistance from an authoritative target fact"
      : "Package-defined neutral ordinary resistance benchmark";
    resistance = {
      kind: "fixed",
      value: numeric,
      provenance: explicitResistance
        ? { kind: "authored", sourceId: explicitResistance.id, description: resistanceReason }
        : { kind: "benchmark", description: resistanceReason },
    };
  }

  const effect = attempt.modes.includes("attack")
    ? ATTEMPT_BENCHMARKS.combatPotentialEffect
    : ATTEMPT_BENCHMARKS.potentialEffect;
  const duration = Math.min(
    ATTEMPT_BENCHMARKS.defaultMaterialTimeMs,
    attempt.remainingHorizonMs,
  );
  const input = resolveActionInputSchema.parse({
    declaredActionId: attempt.actionId,
    actorId: attempt.actorId,
    approach: attempt.declaration,
    feasibility: { status: "feasible" },
    performance: selectedPlan,
    resistance,
    effect: { mode: "fixed", potentialEffect: effect },
    ...(inContest && targetId ? {
      stressConsequence: {
        targetId,
        track: "injury",
        normallyFatal: false,
        pcDeathConsent: false,
        consequenceKind: "external-physical-bodily-injury",
      },
    } : {}),
    timeToMaterialEffectMs: duration,
    scopeIds: [],
  });
  return {
    status: "ready",
    operationId,
    input,
    derivation: {
      rule: "reference-attempt-v1",
      attributes: selectedPlan.attributeIds,
      applicableSkills: selectedPlan.applicableSkillIds,
      helpers: [],
      submittedModifiers: [],
      resistance: resistance.kind,
      resistanceReason,
      ...(resistance.kind === "fixed" ? { resistanceValue: resistance.value } : {}),
      effect,
      materialTimeMs: duration,
      notes: "No assistant, equipment bonus, invented skill, raw model number or invented power; existing assessment determines outcome.",
    },
  };
};
