import { z } from "zod";
import {
  executableIntentSchema,
  type ExecutableIntent,
} from "./action-pressure.js";
import { jsonValueSchema, type JsonValue } from "./json.js";
import { stableIdSchema } from "./identity.js";
import type { CanonicalEvent } from "./events.js";
import type { RandomnessTrace } from "./randomness.js";
import type { FictionalDurationMs } from "./time.js";

export const resolutionPathSchema = z.enum([
  "automatic",
  "impossible",
  "uncertain",
]);
export type ResolutionPath = z.infer<typeof resolutionPathSchema>;

export const resolutionRequestSchema = z
  .object({
    intent: executableIntentSchema,
    operation: z
      .object({
        id: stableIdSchema,
        input: jsonValueSchema,
      })
      .strict(),
  })
  .strict();
export type ResolutionRequest = z.infer<typeof resolutionRequestSchema>;

export interface ResolutionEnvelope<TResult extends JsonValue = JsonValue> {
  readonly intent: ExecutableIntent;
  readonly operationId: string;
  readonly path: ResolutionPath;
  readonly basis: JsonValue;
  readonly result: TResult;
  readonly advanceTimeByMs: FictionalDurationMs;
  readonly randomness: RandomnessTrace | null;
  readonly events: readonly CanonicalEvent[];
}

export class ResolutionValidationError extends Error {
  override readonly name = "ResolutionValidationError";
}
