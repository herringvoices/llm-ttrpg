import { z } from "zod";
import {
  executableIntentSchema,
} from "./action-pressure.js";
import { jsonValueSchema, type JsonValue } from "./json.js";
import { stableIdSchema } from "./identity.js";
import { canonicalEventSchema } from "./events.js";
import { randomnessTraceSchema } from "./randomness.js";
import { fictionalDurationMsSchema } from "./time.js";

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

export function createResolutionEnvelopeSchema<
  TResultSchema extends z.ZodTypeAny,
>(
  resultSchema: TResultSchema,
  operationId?: string,
) {
  return z
    .object({
      intent: executableIntentSchema,
      operationId: operationId === undefined
        ? stableIdSchema
        : z.literal(operationId),
      path: resolutionPathSchema,
      basis: jsonValueSchema,
      result: resultSchema,
      advanceTimeByMs: fictionalDurationMsSchema,
      randomness: randomnessTraceSchema.nullable(),
      events: z.array(canonicalEventSchema),
    })
    .strict();
}

export const resolutionEnvelopeSchema = createResolutionEnvelopeSchema(
  jsonValueSchema,
);

type GenericResolutionEnvelope = z.infer<typeof resolutionEnvelopeSchema>;

export type ResolutionEnvelope<TResult extends JsonValue = JsonValue> =
  Readonly<Omit<GenericResolutionEnvelope, "result"> & {
    readonly result: TResult;
  }>;

export class ResolutionValidationError extends Error {
  override readonly name = "ResolutionValidationError";
}
