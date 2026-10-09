import {
  type RealizationPreparer,
  type PreparedRealization,
} from "@llm-ttrpg/engine";
import { ATTRIBUTE_IDS, rulesEntityStateSchema } from "./model.js";

/** Reference-game baseline for an ordinary, untrained, uninjured subject.
 * Never invent skills, powers, equipment, social ties, or a threat ability. */
function requiredMechanics(
  subject: Readonly<{ kind: string; data: Readonly<Record<string, unknown>> }>,
): unknown {
  const existing = subject.data.mechanics;
  const prior = existing && typeof existing === "object" && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {};
  const human = subject.kind === "actor" || subject.kind === "human";
  if (!human && subject.kind !== "creature" && subject.kind !== "monster") {
    return undefined;
  }
  if (human && prior.isPlayerCharacter === true) return undefined;
  // Fill only missing *mechanical* core fields. Existing values and source
  // constraints take precedence; these neutral values are ruleset policy.
  return {
    ...prior,
    attributes: {
      ...Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, 56])),
      ...(prior.attributes && typeof prior.attributes === "object" && !Array.isArray(prior.attributes)
        ? prior.attributes as Record<string, unknown> : {}),
    },
    skills: prior.skills ?? [],
    stress: prior.stress ?? {
      injury: 0, fear: 0, anger: 0, exhaustion: 0, insecurity: 0,
    },
    statuses: prior.statuses ?? [],
    isPlayerCharacter: prior.isPlayerCharacter ?? false,
    ...(human ? {
      progression: prior.progression ?? {
        characterLevel: 0, characterXp: 0, skillPointsPerCharacterLevel: 5,
        skillLearningRateMultiplier: 1, skillUseEvidence: [],
      },
    } : {}),
  };
}

export const prepareReferenceRealization: RealizationPreparer = ({ request, world }): PreparedRealization => {
  if (request.kind === "person-identity") {
    const observed = world.facts.find((fact) =>
      fact.id === request.sourceId && fact.predicate === "person.observed" &&
      fact.visibility === "public");
    if (!observed || request.scopeId !== observed.subjectId ||
        !request.required.includes(`fact:${request.sourceId}:identity`)) {
      return { status: "unavailable", reason: "Person is not grounded in an accessible canonical observation." };
    }
    const actor = world.entities.find((entity) => entity.id === request.actorId);
    if (!actor || actor.kind !== "actor") {
      return { status: "unavailable", reason: "Missing authorized observer." };
    }
    const target = request.targetLevel;
    if (target !== "ephemeral" && target !== "identified" && target !== "persistent") {
      return { status: "unavailable", reason: "Invalid person identity level." };
    }
    const existing = world.entities.find((entity) =>
      entity.data["observation-source-id"] === observed.id &&
      entity.data["observation-scope-id"] === observed.subjectId);
    const history = existing?.data["identity-resolution-history"];
    const level = Array.isArray(history) ? (history[history.length - 1] as {
      level?: string } | undefined)?.level : undefined;
    const ranks: Readonly<Record<string, number>> = {
      ephemeral: 1, identified: 2, persistent: 3,
    };
    if ((ranks[level ?? ""] ?? 0) >= (ranks[target] ?? 0)) {
      return { status: "already-sufficient" };
    }
    const observedValue = observed.value;
    if (!observedValue || typeof observedValue !== "object" || Array.isArray(observedValue)) {
      return { status: "unavailable", reason: "Observation does not contain structured source detail." };
    }
    const proposedName = (observedValue as Readonly<Record<string, unknown>>).disclosedName;
    if (target !== "ephemeral" && typeof proposedName !== "string") {
      return { status: "unavailable", reason: "The person's name has not been authoritatively disclosed." };
    }
    return { status: "operation", operationId: "rules.realization.realize-observed-person",
      input: {
        observationFactId: observed.id, locationId: observed.subjectId,
        actorId: request.actorId, targetLevel: target,
        occurredAt: request.fictionalTime,
      },
    };
  }
  if (request.kind !== "mechanics") {
    return { status: "unavailable",
      reason: "No authorized source-specific realization was registered for this target." };
  }
  if (request.targetLevel !== "complete") {
    return { status: "unavailable", reason: "Opposed reference checks require complete mechanical core fields." };
  }
  const target = world.entities.find((entity) => entity.id === request.sourceId);
  if (!target) return { status: "unavailable", reason: "The mechanical subject is not canonical." };
  if (!request.required.includes(`entity:${target.id}:mechanics`)) {
    return { status: "unavailable", reason: "No registered check requested this subject's mechanics." };
  }
  if (rulesEntityStateSchema.safeParse(target.data.mechanics).success) {
    return { status: "already-sufficient" };
  }
  const mechanics = requiredMechanics(target);
  if (!mechanics || !rulesEntityStateSchema.safeParse(mechanics).success) {
    return { status: "unavailable",
      reason: "Cannot safely complete mechanics without contradicting previously committed data." };
  }
  const previous = world.mechanicalRealizations.find((item) => item.entityId === target.id);
  const envelope = target.data.threatEnvelope;
  if (target.kind === "creature" && envelope !== undefined &&
      !previous?.constraints.some((item) =>
        item.sourceKind === "threat-envelope" &&
        item.sourceId === target.id &&
        item.summary === JSON.stringify(envelope))) {
    return { status: "unavailable", reason: "The creature's established threat envelope has no durable constraint." };
  }
  return {
    status: "operation",
    operationId: "rules.realization.realize-mechanics",
    input: {
      entityId: target.id,
      subjectKind: target.kind === "creature" || target.kind === "monster" ? "creature" : "human",
      targetLevel: "complete",
      mechanics,
      constraints: [],
      stepId: `realization.${target.id}.foreground-complete`,
      occurredAt: request.fictionalTime,
      generatorVersion: "reference-lazy-mechanics-v1",
      reason: "Foreground registered action requires an authoritative mechanical core.",
      scopeIds: request.scopeId ? [request.scopeId] : [],
    },
  };
};
