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

const rulesetBoundarySchema = z
  .object({
    identity: componentIdentitySchema,
    description: z.string().min(1),
    operations: z.array(z.unknown()),
  })
  .strict();

const settingBoundarySchema = z
  .object({
    identity: componentIdentitySchema,
    description: z.string().min(1),
    content: contentBundleSchema,
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
  })
  .strict();

const campaignBoundarySchema = z
  .object({
    identity: componentIdentitySchema,
    description: z.string().min(1),
    setting: componentIdentitySchema,
    startTime: z.string().datetime(),
    content: contentBundleSchema,
  })
  .strict();

const presentationBoundarySchema = z
  .object({
    identity: componentIdentitySchema,
    description: z.string().min(1),
    narrationStyle: z.string().min(1),
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

  for (const fact of content.facts) {
    if (!entityIds.has(fact.subjectId)) {
      throw new GameValidationError(
        `${label} fact ${fact.id} references missing subject ${fact.subjectId}`,
      );
    }
  }
  for (const event of content.events) {
    for (const participantId of event.participantIds) {
      if (!entityIds.has(participantId)) {
        throw new GameValidationError(
          `${label} event ${event.id} references missing participant ${participantId}`,
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

export function loadGameDefinition(input: unknown): LoadedGameDefinition {
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

  const operationRegistry = createOperationRegistry(
    game.ruleset.operations as readonly RegisteredRulesOperation[],
  );
  const operationIds = new Set(
    game.ruleset.operations.map((operation) => operation.metadata.id),
  );
  validateMappings(game.adapter.mappings, game.setting.content, operationIds);

  // Definitions are immutable source material after the load boundary. Mutable
  // campaign reality is created only by initializeCampaignWorld.
  deepFreeze(game.setting.content);
  deepFreeze(game.campaign.content);

  return {
    ...game,
    operationRegistry,
    composition: compositionFromGame(game),
  };
}
