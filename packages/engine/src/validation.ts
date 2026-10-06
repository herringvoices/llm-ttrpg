import { z } from "zod";
import {
  contentBundleSchema,
  type ContentBundle,
} from "./content.js";
import {
  compositionFromGame,
  type GameDefinition,
  type LoadedGameDefinition,
  type SettingRuleMapping,
} from "./contracts.js";
import {
  componentIdentitySchema,
  sameComponent,
  stableIdSchema,
} from "./identity.js";
import {
  createOperationRegistry,
  type RegisteredRulesOperation,
} from "./operations.js";
import { createEventTypeRegistry } from "./events.js";
import {
  createToolCatalog,
  type SourcedToolCatalogContribution,
} from "./tool-catalog.js";
import { createContextToolCatalogContribution } from "./context-tools.js";
import { createWorldSimulationRegistry } from "./simulation.js";
import { actorSocialStateSchema } from "./actor-social-state.js";
import { mechanicalRealizationSchema } from "./mechanical-realization.js";
import { generationRecordSchema } from "./generation.js";
import { narrationProfileSchema } from "./presentation.js";

const worldSimulationBoundarySchema = z.object({
  scopes: z.array(z.unknown()).optional(),
  processes: z.array(z.unknown()).optional(),
}).strict();

const rulesetBoundarySchema = z
  .object({
    identity: componentIdentitySchema,
    description: z.string().min(1),
    operations: z.array(z.unknown()),
    eventTypes: z.array(z.unknown()),
    toolCatalog: z.unknown().optional(),
    worldSimulation: worldSimulationBoundarySchema.optional(),
  })
  .strict();

const settingBoundarySchema = z
  .object({
    identity: componentIdentitySchema,
    description: z.string().min(1),
    content: contentBundleSchema,
    eventTypes: z.array(z.unknown()),
    toolCatalog: z.unknown().optional(),
    worldSimulation: worldSimulationBoundarySchema.optional(),
  })
  .strict();

const settingRuleMappingBoundarySchema = z
  .object({
    id: stableIdSchema,
    description: z.string().min(1),
    settingConceptId: stableIdSchema,
    operationId: stableIdSchema,
    mapInput: z.custom<(source: unknown) => unknown>(
      (value) => typeof value === "function",
      "Mapping must provide a translation function",
    ),
  })
  .strict();

const adapterBoundarySchema = z
  .object({
    identity: componentIdentitySchema,
    description: z.string().min(1),
    ruleset: componentIdentitySchema,
    setting: componentIdentitySchema,
    mappings: z.array(settingRuleMappingBoundarySchema),
    eventTypes: z.array(z.unknown()),
    toolCatalog: z.unknown().optional(),
    worldSimulation: worldSimulationBoundarySchema.optional(),
  })
  .strict();

const campaignBoundarySchema = z
  .object({
    identity: componentIdentitySchema,
    description: z.string().min(1),
    setting: componentIdentitySchema,
    startTime: z.string().datetime(),
    content: contentBundleSchema,
    actorSocialStates: z.array(actorSocialStateSchema).optional(),
    mechanicalRealizations: z.array(mechanicalRealizationSchema).optional(),
    generationRecord: generationRecordSchema.optional(),
    eventTypes: z.array(z.unknown()),
    toolCatalog: z.unknown().optional(),
    worldSimulation: worldSimulationBoundarySchema.optional(),
  })
  .strict();

const presentationBoundarySchema = z
  .object({
    identity: componentIdentitySchema,
    description: z.string().min(1),
    narrationProfile: narrationProfileSchema,
    terminology: z.record(z.string().min(1)),
    revealMechanics: z.enum(["minimal", "summary", "detailed"]),
  })
  .strict();

const gameDefinitionBoundarySchema = z
  .object({
    ruleset: rulesetBoundarySchema,
    setting: settingBoundarySchema,
    adapter: adapterBoundarySchema,
    campaign: campaignBoundarySchema,
    presentation: presentationBoundarySchema,
  })
  .strict();

export class GameValidationError extends Error {
  override readonly name = "GameValidationError";
}

export interface LoadGameDefinitionOptions {
  readonly engineToolCatalogContributions?: readonly SourcedToolCatalogContribution[];
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function allContentIds(content: ContentBundle): string[] {
  return [
    ...content.entities.map((item) => item.id),
    ...content.facts.map((item) => item.id),
    ...content.events.map((item) => item.id),
    ...content.documents.map((item) => item.id),
    ...content.beliefs.map((item) => item.id),
  ];
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

function validateContentReferences(
  label: string,
  content: ContentBundle,
  availableContent: ContentBundle,
): void {
  const entityIds = new Set(availableContent.entities.map((item) => item.id));
  const factIds = new Set(availableContent.facts.map((item) => item.id));
  const eventIds = new Set(availableContent.events.map((item) => item.id));
  const documentIds = new Set(availableContent.documents.map((item) => item.id));

  for (const fact of content.facts) {
    if (!entityIds.has(fact.subjectId)) {
      throw new GameValidationError(
        `${label} fact ${fact.id} references missing subject ${fact.subjectId}`,
      );
    }
  }
  for (const event of content.events) {
    for (const relatedEntityId of event.relatedEntityIds) {
      if (!entityIds.has(relatedEntityId)) {
        throw new GameValidationError(
          `${label} event ${event.id} references missing entity ${relatedEntityId}`,
        );
      }
    }
  }
  for (const document of content.documents) {
    for (const entityId of document.metadata.relatedEntityIds) {
      if (!entityIds.has(entityId)) {
        throw new GameValidationError(
          `${label} document ${document.id} references missing entity ${entityId}`,
        );
      }
    }
  }
  for (const belief of content.beliefs) {
    if (!entityIds.has(belief.holder.id)) {
      throw new GameValidationError(
        `${label} belief ${belief.id} references missing holder ${belief.holder.id}`,
      );
    }
    if (!entityIds.has(belief.subjectId)) {
      throw new GameValidationError(
        `${label} belief ${belief.id} references missing subject ${belief.subjectId}`,
      );
    }
    if (belief.sourceFactId && !factIds.has(belief.sourceFactId)) {
      throw new GameValidationError(
        `${label} belief ${belief.id} references missing fact ${belief.sourceFactId}`,
      );
    }
    for (const source of belief.sources ?? []) {
      const valid = source.kind === "fact"
        ? factIds.has(source.id)
        : source.kind === "event"
          ? eventIds.has(source.id)
          : source.kind === "document"
            ? documentIds.has(source.id)
            : source.kind === "testimony"
              ? entityIds.has(source.id)
              : true;
      if (!valid) {
        throw new GameValidationError(
          `${label} belief ${belief.id} references missing ${source.kind} source ${source.id}`,
        );
      }
    }
  }
}

function validateCampaignStateReferences(
  game: GameDefinition,
  availableContent: ContentBundle,
): void {
  const entityIds = new Set(availableContent.entities.map((item) => item.id));
  const eventIds = new Set(availableContent.events.map((item) => item.id));
  const factIds = new Set(availableContent.facts.map((item) => item.id));
  const socialStates = game.campaign.actorSocialStates ?? [];
  const memoryIds = new Set(socialStates.flatMap((state) =>
    state.memories.map((memory) => memory.id)
  ));

  const requireEntity = (owner: string, entityId: string): void => {
    if (!entityIds.has(entityId)) {
      throw new GameValidationError(
        `${owner} references missing entity ${entityId}`,
      );
    }
  };
  const requireEvent = (owner: string, eventId: string): void => {
    if (!eventIds.has(eventId)) {
      throw new GameValidationError(
        `${owner} references missing event ${eventId}`,
      );
    }
  };

  const actorIds = new Set<string>();
  for (const state of socialStates) {
    actorSocialStateSchema.parse(state);
    requireEntity(`Social state ${state.actorId}`, state.actorId);
    if (actorIds.has(state.actorId)) {
      throw new GameValidationError(
        `Duplicate campaign actor social state: ${state.actorId}`,
      );
    }
    actorIds.add(state.actorId);
    for (const goal of state.goals) {
      goal.relatedEntityIds.forEach((id) =>
        requireEntity(`Goal ${goal.id}`, id)
      );
      goal.sourceEventIds?.forEach((id) =>
        requireEvent(`Goal ${goal.id}`, id)
      );
    }
    for (const relationship of state.relationships) {
      requireEntity(`Relationship ${relationship.id}`, relationship.targetEntityId);
      relationship.sourceEventIds?.forEach((id) =>
        requireEvent(`Relationship ${relationship.id}`, id)
      );
    }
    for (const memory of state.memories) {
      memory.relatedEntityIds.forEach((id) =>
        requireEntity(`Memory ${memory.id}`, id)
      );
      memory.sourceEventIds.forEach((id) =>
        requireEvent(`Memory ${memory.id}`, id)
      );
    }
    for (const commitment of state.commitments) {
      commitment.relatedEntityIds.forEach((id) =>
        requireEntity(`Commitment ${commitment.id}`, id)
      );
      commitment.sourceEventIds?.forEach((id) =>
        requireEvent(`Commitment ${commitment.id}`, id)
      );
    }
  }

  for (const belief of game.campaign.content.beliefs) {
    for (const source of belief.sources ?? []) {
      if (source.kind === "memory" && !memoryIds.has(source.id)) {
        throw new GameValidationError(
          `Campaign belief ${belief.id} references missing memory source ${source.id}`,
        );
      }
    }
  }

  const realized = new Set<string>();
  for (const realization of game.campaign.mechanicalRealizations ?? []) {
    mechanicalRealizationSchema.parse(realization);
    requireEntity(`Mechanical realization ${realization.entityId}`, realization.entityId);
    if (realized.has(realization.entityId)) {
      throw new GameValidationError(
        `Duplicate campaign mechanical realization: ${realization.entityId}`,
      );
    }
    realized.add(realization.entityId);
    const constraintIds = new Set(realization.constraints.map((item) => item.id));
    for (const constraint of realization.constraints) {
      if (
        constraint.sourceKind === "canonical-fact" &&
        !factIds.has(constraint.sourceId)
      ) {
        throw new GameValidationError(
          `Mechanical constraint ${constraint.id} references missing fact ${constraint.sourceId}`,
        );
      }
      if (
        constraint.sourceKind === "canonical-event" &&
        !eventIds.has(constraint.sourceId)
      ) {
        throw new GameValidationError(
          `Mechanical constraint ${constraint.id} references missing event ${constraint.sourceId}`,
        );
      }
      if (
        constraint.sourceKind === "entity" &&
        !entityIds.has(constraint.sourceId)
      ) {
        throw new GameValidationError(
          `Mechanical constraint ${constraint.id} references missing entity ${constraint.sourceId}`,
        );
      }
    }
    for (const step of realization.history) {
      for (const constraintId of step.constraintIds) {
        if (!constraintIds.has(constraintId)) {
          throw new GameValidationError(
            `Realization step ${step.id} references missing constraint ${constraintId}`,
          );
        }
      }
    }
  }
}

function mergeContent(
  first: ContentBundle,
  second: ContentBundle,
): ContentBundle {
  return {
    entities: [...first.entities, ...second.entities],
    facts: [...first.facts, ...second.facts],
    events: [...first.events, ...second.events],
    documents: [...first.documents, ...second.documents],
    beliefs: [...first.beliefs, ...second.beliefs],
  };
}

function validateMappings(
  mappings: readonly SettingRuleMapping[],
  settingContent: ContentBundle,
  operationIds: ReadonlySet<string>,
): void {
  const duplicateIds = findDuplicates(mappings.map((mapping) => mapping.id));
  if (duplicateIds.length > 0) {
    throw new GameValidationError(
      `Duplicate adapter mapping IDs: ${duplicateIds.join(", ")}`,
    );
  }

  const settingIds = new Set(allContentIds(settingContent));
  for (const mapping of mappings) {
    if (!settingIds.has(mapping.settingConceptId)) {
      throw new GameValidationError(
        `Adapter mapping ${mapping.id} references missing setting concept ${mapping.settingConceptId}`,
      );
    }
    if (!operationIds.has(mapping.operationId)) {
      throw new GameValidationError(
        `Adapter mapping ${mapping.id} references missing rules operation ${mapping.operationId}`,
      );
    }
  }
}

function validateAuthoredEventCausality(content: ContentBundle): void {
  const ordered = content.events
    .map((event, index) => ({ event, index }))
    .sort(
      (left, right) =>
        left.event.occurredAt.localeCompare(right.event.occurredAt) ||
        left.index - right.index,
    );
  const prior = new Set<string>();
  for (const { event } of ordered) {
    for (const causeId of event.causedByEventIds) {
      if (!prior.has(causeId)) {
        throw new GameValidationError(
          `Event ${event.id} references non-prior cause ${causeId}`,
        );
      }
    }
    prior.add(event.id);
  }
}

export function loadGameDefinition(
  input: unknown,
  options: LoadGameDefinitionOptions = {},
): LoadedGameDefinition {
  const parsed = gameDefinitionBoundarySchema.parse(input);
  const game = parsed as unknown as GameDefinition;

  const componentIds = [
    game.ruleset.identity.id,
    game.setting.identity.id,
    game.adapter.identity.id,
    game.campaign.identity.id,
    game.presentation.identity.id,
  ];
  const duplicateComponentIds = findDuplicates(componentIds);
  if (duplicateComponentIds.length > 0) {
    throw new GameValidationError(
      `Duplicate game component IDs: ${duplicateComponentIds.join(", ")}`,
    );
  }

  if (!sameComponent(game.ruleset.identity, game.adapter.ruleset)) {
    throw new GameValidationError(
      `Adapter ${game.adapter.identity.id} is not compatible with ruleset ${game.ruleset.identity.id}@${game.ruleset.identity.version}`,
    );
  }
  if (!sameComponent(game.setting.identity, game.adapter.setting)) {
    throw new GameValidationError(
      `Adapter ${game.adapter.identity.id} is not compatible with setting ${game.setting.identity.id}@${game.setting.identity.version}`,
    );
  }
  if (!sameComponent(game.setting.identity, game.campaign.setting)) {
    throw new GameValidationError(
      `Campaign ${game.campaign.identity.id} requires a different setting composition`,
    );
  }

  const combinedContent = mergeContent(
    game.setting.content,
    game.campaign.content,
  );
  const duplicateContentIds = findDuplicates(allContentIds(combinedContent));
  if (duplicateContentIds.length > 0) {
    throw new GameValidationError(
      `Duplicate content IDs: ${duplicateContentIds.join(", ")}`,
    );
  }
  validateContentReferences("Setting", game.setting.content, game.setting.content);
  validateContentReferences("Campaign", game.campaign.content, combinedContent);
  validateCampaignStateReferences(game, combinedContent);
  validateAuthoredEventCausality(game.setting.content);
  validateAuthoredEventCausality(game.campaign.content);
  for (const event of game.campaign.content.events) {
    if (event.occurredAt > game.campaign.startTime) {
      throw new GameValidationError(
        `Campaign event ${event.id} occurs after campaign start time`,
      );
    }
  }

  const operationRegistry = createOperationRegistry(
    game.ruleset.operations as readonly RegisteredRulesOperation[],
  );
  const packageToolCatalogContributions: SourcedToolCatalogContribution[] = [
    game.ruleset,
    game.setting,
    game.adapter,
    game.campaign,
  ].flatMap((component) =>
    component.toolCatalog
      ? [{
          sourceComponent: component.identity,
          contribution: component.toolCatalog,
        }]
      : [],
  );
  const toolCatalog = createToolCatalog({
    operationRegistry,
    rulesetSource: game.ruleset.identity,
    contributions: [
      createContextToolCatalogContribution(game),
      ...(options.engineToolCatalogContributions ?? []),
      ...packageToolCatalogContributions,
    ],
  });
  const eventTypeRegistry = createEventTypeRegistry([
    game.ruleset,
    game.setting,
    game.adapter,
    game.campaign,
  ]);
  const worldSimulationRegistry = createWorldSimulationRegistry(
    [game.ruleset, game.setting, game.adapter, game.campaign].flatMap(
      (component) => component.worldSimulation
        ? [{
            sourceComponent: component.identity,
            contribution: component.worldSimulation,
          }]
        : [],
    ),
  );
  for (const event of combinedContent.events) {
    eventTypeRegistry.validatePayload(
      event.type,
      event.schemaVersion,
      event.payload,
    );
  }
  const operationIds = new Set(
    game.ruleset.operations.map((operation) => operation.metadata.id),
  );
  validateMappings(game.adapter.mappings, game.setting.content, operationIds);

  // Definitions are immutable source material after the load boundary. Mutable
  // campaign reality is created only by initializeCampaignWorld.
  deepFreeze(game.setting.content);
  deepFreeze(game.campaign.content);
  if (game.campaign.actorSocialStates) deepFreeze(game.campaign.actorSocialStates);
  if (game.campaign.mechanicalRealizations) {
    deepFreeze(game.campaign.mechanicalRealizations);
  }
  if (game.campaign.generationRecord) deepFreeze(game.campaign.generationRecord);
  for (const component of [game.ruleset, game.setting, game.adapter, game.campaign]) {
    if (component.worldSimulation) deepFreeze(component.worldSimulation);
  }

  return {
    ...game,
    operationRegistry,
    eventTypeRegistry,
    toolCatalog,
    worldSimulationRegistry,
    composition: compositionFromGame(game),
  };
}
