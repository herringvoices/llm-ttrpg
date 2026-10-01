import { z } from "zod";
import {
  compositionFromGame,
  type GameComposition,
  type LoadedGameDefinition,
} from "./contracts.js";
import { componentIdentitySchema, stableIdSchema } from "./identity.js";

export const gameCompositionSchema = z
  .object({
    ruleset: componentIdentitySchema,
    setting: componentIdentitySchema,
    adapter: componentIdentitySchema,
    campaign: componentIdentitySchema,
    presentation: componentIdentitySchema,
  })
  .strict();

export const saveMetadataSchema = z
  .object({
    saveId: stableIdSchema,
    createdAt: z.string().datetime(),
    game: gameCompositionSchema,
  })
  .strict();

export type SaveMetadata = z.infer<typeof saveMetadataSchema>;

export class SaveCompatibilityError extends Error {
  override readonly name = "SaveCompatibilityError";
}

export function createSaveMetadata(
  game: LoadedGameDefinition,
  saveId: string,
  createdAt: string,
): SaveMetadata {
  return saveMetadataSchema.parse({
    saveId,
    createdAt,
    game: compositionFromGame(game),
  });
}

function describeCompositionMismatch(
  saved: GameComposition,
  active: GameComposition,
): string | undefined {
  for (const key of [
    "ruleset",
    "setting",
    "adapter",
    "campaign",
    "presentation",
  ] as const) {
    const savedComponent = saved[key];
    const activeComponent = active[key];
    if (
      savedComponent.id !== activeComponent.id ||
      savedComponent.version !== activeComponent.version
    ) {
      return `${key} requires ${savedComponent.id}@${savedComponent.version}, active game provides ${activeComponent.id}@${activeComponent.version}`;
    }
  }
  return undefined;
}

export function validateSaveMetadataForGame(
  input: unknown,
  game: LoadedGameDefinition,
): SaveMetadata {
  const metadata = saveMetadataSchema.parse(input);
  validateGameCompositionForGame(metadata.game, game);
  return metadata;
}

export function validateGameCompositionForGame(
  input: unknown,
  game: LoadedGameDefinition,
): GameComposition {
  const composition = gameCompositionSchema.parse(input);
  const mismatch = describeCompositionMismatch(composition, game.composition);
  if (mismatch) {
    throw new SaveCompatibilityError(`Incompatible save composition: ${mismatch}`);
  }
  return composition;
}
