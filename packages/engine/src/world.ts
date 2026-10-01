import type {
  Belief,
  CanonicalEvent,
  CanonicalFact,
  Entity,
  LongFormDocument,
} from "./content.js";
import {
  beliefSchema,
  canonicalEventSchema,
  canonicalFactSchema,
  entitySchema,
  longFormDocumentSchema,
} from "./content.js";
import {
  compositionFromGame,
  type GameComposition,
  type LoadedGameDefinition,
} from "./contracts.js";
import { gameCompositionSchema } from "./save.js";
import { z } from "zod";

export const worldStateSchema = z
  .object({
    game: gameCompositionSchema,
    initializedFromCampaign: z.string().min(1),
    fictionalTime: z.string().datetime(),
    entities: z.array(entitySchema),
    facts: z.array(canonicalFactSchema),
    events: z.array(canonicalEventSchema),
    documents: z.array(longFormDocumentSchema),
    beliefs: z.array(beliefSchema),
  })
  .strict();

export interface WorldState {
  game: GameComposition;
  initializedFromCampaign: string;
  fictionalTime: string;
  entities: Entity[];
  facts: CanonicalFact[];
  events: CanonicalEvent[];
  documents: LongFormDocument[];
  beliefs: Belief[];
}

export function validateWorldState(input: unknown): WorldState {
  return worldStateSchema.parse(input);
}

export function initializeCampaignWorld(
  game: LoadedGameDefinition,
): WorldState {
  const content = JSON.parse(
    JSON.stringify(game.campaign.content),
  ) as typeof game.campaign.content;
  return validateWorldState({
    game: compositionFromGame(game),
    initializedFromCampaign: game.campaign.identity.id,
    fictionalTime: game.campaign.startTime,
    entities: content.entities,
    facts: content.facts,
    events: content.events,
    documents: content.documents,
    beliefs: content.beliefs,
  });
}
