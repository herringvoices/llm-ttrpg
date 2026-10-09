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
  if (request.kind === "entity-detail") {
    const entity = world.entities.find((entry) => entry.id === request.sourceId);
    if (!entity || request.targetLevel !== "minimal" || request.required.length !== 1) {
      return { status: "unavailable", reason: "Missing a canonical entity or one specific required detail." };
    }
    const prefix = `entity:${entity.id}:`;
    const required = request.required[0]!;
    const key = required.startsWith(prefix) ? required.slice(prefix.length) : "";
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(key)) {
      return { status: "unavailable", reason: "The request lacks one valid missing entity-data key." };
    }
    const fact = world.facts.find((item) =>
      item.subjectId === entity.id &&
      item.predicate === `entity.detail.${key}` &&
      item.visibility === "public");
    if (!fact) return { status: "unavailable", reason: "No publicly established source for this detail." };
    if (Object.prototype.hasOwnProperty.call(entity.data, key)) {
      return JSON.stringify(entity.data[key]) === JSON.stringify(fact.value)
        ? { status: "already-sufficient" }
        : { status: "unavailable", reason: "Established data conflicts with the proposed source." };
    }
    return { status: "operation", operationId: "rules.realization.realize-sourced-detail",
      input: { entityId: entity.id, factId: fact.id, dataKey: key } };
  }
  if (request.kind === "location") {
    if (request.trigger.kind !== "location-entry" ||
        request.targetLevel !== "minimal" ||
        request.required.length !== 1 ||
        request.required[0] !== `fact:${request.sourceId}:location`) {
      return { status: "unavailable", reason: "Only a validated entry may realize a location hint." };
    }
    const fact = world.facts.find((item) =>
      item.id === request.sourceId &&
      item.predicate === "location.hint" && item.visibility === "public");
    if (!fact || request.scopeId !== fact.subjectId) {
      return { status: "unavailable", reason: "Missing source-grounded location hint in the requested scope." };
    }
    const placeValue = fact.value;
    if (!placeValue || typeof placeValue !== "object" || Array.isArray(placeValue)) {
      return { status: "unavailable", reason: "Location hint is not structured." };
    }
    const name = (placeValue as Readonly<Record<string, unknown>>).name;
    if (typeof name !== "string" || name.trim().length === 0) {
      return { status: "unavailable", reason: "Location hint lacks a name." };
    }
    const actor = world.entities.find((entity) => entity.id === request.actorId);
    if (!actor || actor.kind !== "actor") {
      return { status: "unavailable", reason: "Actor is not canonical." };
    }
    const current = [...world.facts].reverse().find((entry) =>
      entry.subjectId === actor.id && entry.predicate === "actor.current-location"
      && typeof entry.value === "string")?.value ?? actor.data.currentLocation;
    const currentPlace = typeof current === "string"
      ? world.entities.find((entity) => entity.id === current) : undefined;
    const existing = world.entities.find((entity) =>
      entity.kind === "location" &&
      entity.data["location-source-fact-id"] === fact.id &&
      entity.data.parentLocationId === fact.subjectId);
    if (existing?.id === current) return { status: "already-sufficient" };
    if (current !== fact.subjectId && currentPlace?.data.parentLocationId !== fact.subjectId) {
      return { status: "unavailable", reason: "A validated local entry requires the actor to be at the parent or its known child." };
    }
    return {
      status: "operation", operationId: "rules.actions.enter-local-place",
      input: { actorId: actor.id, placeName: name.trim(), travelDurationMs: 0,
        sourceFactId: fact.id },
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
