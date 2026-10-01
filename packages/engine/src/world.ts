import type {
  Belief,
  CanonicalEvent,
  CanonicalFact,
  Entity,
  LongFormDocument,
} from "./content.js";
import {
  compositionFromGame,
  type GameComposition,
  type LoadedGameDefinition,
} from "./contracts.js";

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

export function initializeCampaignWorld(
  game: LoadedGameDefinition,
): WorldState {
  const content = structuredClone(game.campaign.content);
  return {
    game: compositionFromGame(game),
    initializedFromCampaign: game.campaign.identity.id,
    fictionalTime: game.campaign.startTime,
    entities: content.entities,
    facts: content.facts,
    events: content.events,
    documents: content.documents,
    beliefs: content.beliefs,
  };
}

