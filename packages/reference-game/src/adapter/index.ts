import {
  canonicalFactSchema,
  stableIdSchema,
  worldStateSchema,
  type CanonicalFact,
  type JsonValue,
  type SettingAdapter,
  type WorldState,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  resolveActionInputSchema,
  rulesActorStateSchema,
  type ResolveActionInput,
} from "../ruleset/index.js";

export const MAGICAL_INTERACTION_FACT_IDS = Object.freeze({
  resistance: "setting.fact.magical-resistance",
  wieldedObject: "setting.fact.wielded-object-empowerment",
  projectileDissipation: "setting.fact.ranged-empowerment-dissipates",
} as const);

const magicalResistanceMappingSchema = z.object({
  action: resolveActionInputSchema,
  magicalResistanceApplies: z.boolean(),
}).strict();

function withProvenance(
  action: ResolveActionInput,
  sourceIds: readonly string[],
): ResolveActionInput {
  if (action.resistance.kind !== "fixed") {
    throw new Error(
      "Awakening Earth magical-interaction provenance currently requires fixed Resistance.",
    );
  }
  return resolveActionInputSchema.parse({
    ...action,
    resistance: {
      ...action.resistance,
      provenance: {
        ...action.resistance.provenance,
        sourceId: sourceIds[0],
        sourceIds,
        description:
          `${action.resistance.provenance.description}; Awakening Earth interaction facts: ${sourceIds.join(", ")}`,
      },
    },
  });
}

function mapMagicalResistanceProvenance(source: JsonValue): unknown {
  const input = magicalResistanceMappingSchema.parse(source);
  if (!input.magicalResistanceApplies) return input.action;
  return withProvenance(input.action, [MAGICAL_INTERACTION_FACT_IDS.resistance]);
}

export const interactionSourceSchema = z.enum([
  "mundane",
  "awakened-body",
  "ordinary-wielded-object",
  "intrinsically-magical",
  "magical-item",
  "sustained-ranged-magical",
]);

export const interactionEffectSchema = z.enum([
  "direct-material-bodily-harm",
  "displacement",
  "restraint",
  "environmental-indirect",
  "other",
]);

export const interactionContactSchema = z.enum([
  "direct-contact",
  "released-projectile",
  "ranged",
]);

export const magicalInteractionRequestSchema = z.object({
  action: resolveActionInputSchema,
  targetId: stableIdSchema,
  source: interactionSourceSchema,
  contact: interactionContactSchema,
  effect: interactionEffectSchema,
  objectId: stableIdSchema.optional(),
}).strict();

const classifiedMagicalInteractionSchema = z.object({
  action: resolveActionInputSchema,
  targetMagical: z.boolean(),
  sourceMagicalAtEffect: z.boolean(),
  effect: interactionEffectSchema,
  provenanceFactIds: z.array(stableIdSchema).min(1),
}).strict();

const magicalInteractionMappingSchema = z.object({
  world: worldStateSchema,
  settingFacts: z.array(canonicalFactSchema),
  request: magicalInteractionRequestSchema,
}).strict();

function mapClassifiedMagicalInteraction(source: JsonValue): unknown {
  const input = classifiedMagicalInteractionSchema.parse(source);
  const action = withProvenance(input.action, input.provenanceFactIds);
  if (
    input.targetMagical &&
    input.effect === "direct-material-bodily-harm" &&
    !input.sourceMagicalAtEffect
  ) {
    return resolveActionInputSchema.parse({
      ...action,
      feasibility: {
        status: "impossible",
        reason:
          "Ordinary mundane force cannot directly damage intrinsically magical structure.",
      },
      ...(action.stressConsequence
        ? {
            stressConsequence: {
              ...action.stressConsequence,
              consequenceKind: "external-physical-bodily-injury",
            },
          }
        : {}),
    });
  }
  return resolveActionInputSchema.parse({
    ...action,
    ...(action.stressConsequence &&
        input.effect === "direct-material-bodily-harm"
      ? {
          stressConsequence: {
            ...action.stressConsequence,
            consequenceKind: "external-physical-bodily-injury",
          },
        }
      : {}),
  });
}

function requiredFact(
  source: MagicalInteractionState,
  id: string,
): void {
  if (![...source.settingFacts, ...source.world.facts].some((fact) => fact.id === id)) {
    throw new Error(`Missing established Awakening Earth fact ${id}`);
  }
}

export interface MagicalInteractionState {
  readonly world: WorldState;
  readonly settingFacts: readonly CanonicalFact[];
}

function actorIsAwakened(world: WorldState, actorId: string): boolean {
  const actor = world.entities.find((item) => item.id === actorId);
  const mechanics = rulesActorStateSchema.safeParse(actor?.data.mechanics);
  return mechanics.success &&
    mechanics.data.progression.characterLevel > 0 &&
    (mechanics.data.progression.powers?.length ?? 0) > 0;
}

/** Derives pair-specific interaction truth from committed world state. */
export function mapAwakeningEarthMagicalInteraction(
  sourceState: MagicalInteractionState,
  rawRequest: unknown,
): ResolveActionInput {
  const request = magicalInteractionRequestSchema.parse(rawRequest);
  requiredFact(sourceState, MAGICAL_INTERACTION_FACT_IDS.resistance);
  const world = sourceState.world;
  const target = world.entities.find((item) => item.id === request.targetId);
  if (!target) throw new Error(`Missing interaction target ${request.targetId}`);
  const targetMagical = target.data.magicalStructure === true;
  const provenanceFactIds: string[] = [MAGICAL_INTERACTION_FACT_IDS.resistance];
  let sourceMagicalAtEffect = request.source === "intrinsically-magical" ||
    request.source === "magical-item" ||
    request.source === "sustained-ranged-magical";

  if (request.source === "awakened-body") {
    sourceMagicalAtEffect = actorIsAwakened(world, request.action.actorId) &&
      request.contact === "direct-contact";
  }
  if (request.source === "ordinary-wielded-object") {
    requiredFact(sourceState, MAGICAL_INTERACTION_FACT_IDS.wieldedObject);
    provenanceFactIds.push(MAGICAL_INTERACTION_FACT_IDS.wieldedObject);
    const object = request.objectId
      ? world.entities.find((item) => item.id === request.objectId)
      : undefined;
    const wieldingFact = request.objectId
      ? world.facts.find((fact) =>
          fact.subjectId === request.objectId &&
          fact.predicate === "object.directly-wielded-by" &&
          fact.value === request.action.actorId
        )
      : undefined;
    sourceMagicalAtEffect = actorIsAwakened(world, request.action.actorId) &&
      request.contact === "direct-contact" &&
      object?.data.currentWielderId === request.action.actorId &&
      wieldingFact !== undefined;
    if (request.contact !== "direct-contact") {
      requiredFact(sourceState, MAGICAL_INTERACTION_FACT_IDS.projectileDissipation);
      provenanceFactIds.push(
        MAGICAL_INTERACTION_FACT_IDS.projectileDissipation,
      );
    }
  }

  return mapClassifiedMagicalInteraction({
    action: request.action,
    targetMagical,
    sourceMagicalAtEffect,
    effect: request.effect,
    provenanceFactIds,
  } as JsonValue) as ResolveActionInput;
}

function mapMagicalInteractionFromState(source: JsonValue): unknown {
  const input = magicalInteractionMappingSchema.parse(source);
  return mapAwakeningEarthMagicalInteraction(
    { world: input.world, settingFacts: input.settingFacts },
    input.request,
  );
}

export const awakeningEarthReferenceAdapter: SettingAdapter = {
  identity: { id: "awakening-earth-reference-adapter", version: "0.3.0" },
  description:
    "Pair-specific bindings from Awakening Earth truths into reusable reference-rules inputs.",
  ruleset: { id: "reference-rules", version: "0.3.0" },
  setting: { id: "awakening-earth", version: "0.2.0" },
  eventTypes: [],
  mappings: [
    {
      id: "adapter.mapping.magical-resistance-provenance",
      description:
        "Attach the canonical Awakening Earth magical-resistance fact to Resistance provenance.",
      settingConceptId: MAGICAL_INTERACTION_FACT_IDS.resistance,
      operationId: "rules.actions.resolve-action",
      mapInput: mapMagicalResistanceProvenance,
    },
    {
      id: "adapter.mapping.magical-interaction",
      description:
        "Classify direct harm, contact empowerment, projectile dissipation, and independently resolvable non-injury effects.",
      settingConceptId: MAGICAL_INTERACTION_FACT_IDS.resistance,
      operationId: "rules.actions.resolve-action",
      mapInput: mapMagicalInteractionFromState,
    },
  ],
};
