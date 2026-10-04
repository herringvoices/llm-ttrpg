import type {
  Belief,
  CanonicalFact,
  Entity,
  LongFormDocument,
} from "./content.js";
import {
  beliefSchema,
  canonicalFactSchema,
  entitySchema,
  longFormDocumentSchema,
} from "./content.js";
import {
  canonicalEventSchema,
  type CanonicalEvent,
} from "./events.js";
import {
  compositionFromGame,
  type GameComposition,
  type LoadedGameDefinition,
} from "./contracts.js";
import { gameCompositionSchema } from "./save.js";
import { componentIdentitySchema, stableIdSchema } from "./identity.js";
import { jsonValueSchema } from "./json.js";
import {
  compareFictionalInstants,
  fictionalInstantSchema,
  type FictionalInstant,
} from "./time.js";
import { z } from "zod";
import {
  actionPressureStateSchema,
  type ActionPressureState,
} from "./action-pressure.js";
import {
  actorSocialStateSchema,
  type ActorSocialState,
} from "./actor-social-state.js";
import {
  mechanicalRealizationSchema,
  validateMechanicalRealizationUpdate,
  type MechanicalRealization,
} from "./mechanical-realization.js";
import {
  generationRecordSchema,
  type GenerationRecord,
} from "./generation.js";
import {
  initialRandomnessState,
  randomnessStateSchema,
  type RandomnessState,
} from "./randomness.js";

export const simulationCursorSchema = z
  .object({
    scopeId: stableIdSchema,
    lastSimulatedAt: fictionalInstantSchema,
  })
  .strict();
export type SimulationCursor = z.infer<typeof simulationCursorSchema>;

export const scheduledTriggerSchema = z
  .object({
    id: stableIdSchema,
    type: stableIdSchema,
    schemaVersion: z.number().int().positive(),
    sourceComponent: componentIdentitySchema,
    dueAt: fictionalInstantSchema,
    scopeIds: z.array(stableIdSchema),
    payload: jsonValueSchema,
  })
  .strict();
export type ScheduledTrigger = z.infer<typeof scheduledTriggerSchema>;

export const worldStateSchema = z
  .object({
    game: gameCompositionSchema,
    initializedFromCampaign: z.string().min(1),
    fictionalTime: fictionalInstantSchema,
    actionPressure: actionPressureStateSchema,
    randomness: randomnessStateSchema,
    entities: z.array(entitySchema),
    facts: z.array(canonicalFactSchema),
    documents: z.array(longFormDocumentSchema),
    beliefs: z.array(beliefSchema),
    actorSocialStates: z.array(actorSocialStateSchema).default([]),
    mechanicalRealizations: z.array(mechanicalRealizationSchema).default([]),
    generationRecord: generationRecordSchema.optional(),
    scheduledTriggers: z.array(scheduledTriggerSchema),
    simulationCursors: z.array(simulationCursorSchema),
  })
  .strict()
  .superRefine((state, context) => {
    const cursorScopes = new Set<string>();
    for (const [index, cursor] of state.simulationCursors.entries()) {
      if (cursorScopes.has(cursor.scopeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate simulation cursor: ${cursor.scopeId}`,
          path: ["simulationCursors", index, "scopeId"],
        });
      }
      cursorScopes.add(cursor.scopeId);
      if (compareFictionalInstants(cursor.lastSimulatedAt, state.fictionalTime) > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Simulation cursor cannot be later than world time",
          path: ["simulationCursors", index, "lastSimulatedAt"],
        });
      }
    }
    const entityIds = new Set(state.entities.map((entity) => entity.id));
    const socialActors = new Set<string>();
    for (const [index, social] of state.actorSocialStates.entries()) {
      if (!entityIds.has(social.actorId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Social state references missing actor: ${social.actorId}`,
          path: ["actorSocialStates", index, "actorId"],
        });
      }
      if (socialActors.has(social.actorId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate social state: ${social.actorId}`,
          path: ["actorSocialStates", index, "actorId"],
        });
      }
      socialActors.add(social.actorId);
    }
    const mechanicalEntities = new Set<string>();
    for (const [index, realization] of state.mechanicalRealizations.entries()) {
      if (!entityIds.has(realization.entityId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Mechanical realization references missing entity: ${realization.entityId}`,
          path: ["mechanicalRealizations", index, "entityId"],
        });
      }
      if (mechanicalEntities.has(realization.entityId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate mechanical realization: ${realization.entityId}`,
          path: ["mechanicalRealizations", index, "entityId"],
        });
      }
      mechanicalEntities.add(realization.entityId);
      try {
        validateMechanicalRealizationUpdate(undefined, realization);
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : String(error),
          path: ["mechanicalRealizations", index],
        });
      }
    }
    const triggerIds = new Set<string>();
    for (const [index, trigger] of state.scheduledTriggers.entries()) {
      if (triggerIds.has(trigger.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate scheduled trigger: ${trigger.id}`,
          path: ["scheduledTriggers", index, "id"],
        });
      }
      triggerIds.add(trigger.id);
    }
  });

export interface WorldState {
  game: GameComposition;
  initializedFromCampaign: string;
  fictionalTime: FictionalInstant;
  actionPressure: ActionPressureState;
  randomness: RandomnessState;
  entities: Entity[];
  facts: CanonicalFact[];
  documents: LongFormDocument[];
  beliefs: Belief[];
  actorSocialStates: ActorSocialState[];
  mechanicalRealizations: MechanicalRealization[];
  generationRecord?: GenerationRecord;
  scheduledTriggers: ScheduledTrigger[];
  simulationCursors: SimulationCursor[];
}

export function validateWorldState(input: unknown): WorldState {
  return worldStateSchema.parse(input);
}

export function initializeCampaignWorld(
  game: LoadedGameDefinition,
  rootSeed: number,
): WorldState {
  const content = JSON.parse(
    JSON.stringify(game.campaign.content),
  ) as typeof game.campaign.content;
  return validateWorldState({
    game: compositionFromGame(game),
    initializedFromCampaign: game.campaign.identity.id,
    fictionalTime: game.campaign.startTime,
    actionPressure: { status: "unassessed" },
    randomness: initialRandomnessState(rootSeed),
    entities: content.entities,
    facts: content.facts,
    documents: content.documents,
    beliefs: content.beliefs,
    actorSocialStates: JSON.parse(JSON.stringify(game.campaign.actorSocialStates ?? [])),
    mechanicalRealizations: JSON.parse(JSON.stringify(game.campaign.mechanicalRealizations ?? [])),
    ...(game.campaign.generationRecord
      ? { generationRecord: JSON.parse(JSON.stringify(game.campaign.generationRecord)) }
      : {}),
    scheduledTriggers: [],
    simulationCursors: game.worldSimulationRegistry.listScopes().map((scope) => ({
      scopeId: scope.id,
      lastSimulatedAt: game.campaign.startTime,
    })),
  });
}

export function initializeCampaignHistory(
  game: LoadedGameDefinition,
): CanonicalEvent[] {
  const seeds = game.campaign.content.events
    .map((event, index) => ({ event, index }))
    .sort(
      (left, right) =>
        compareFictionalInstants(
          left.event.occurredAt,
          right.event.occurredAt,
        ) || left.index - right.index,
    );
  const priorIds = new Set<string>();

  return seeds.map(({ event }, index) => {
    for (const causeId of event.causedByEventIds) {
      if (!priorIds.has(causeId)) {
        throw new Error(
          `Campaign event ${event.id} has non-prior cause ${causeId}`,
        );
      }
    }
    const definition = game.eventTypeRegistry.resolve(
      event.type,
      event.schemaVersion,
    );
    const canonical = canonicalEventSchema.parse({
      ...event,
      payload: game.eventTypeRegistry.validatePayload(
        event.type,
        event.schemaVersion,
        event.payload,
      ),
      sourceComponent: definition.sourceComponent,
      sequence: index + 1,
    });
    priorIds.add(canonical.id);
    return canonical;
  });
}
