import { z } from "zod";
import { stableIdSchema } from "./identity.js";
import { jsonValueSchema, type JsonValue } from "./json.js";
import { semanticActionModeSchema } from "./semantic-action.js";
import type { DeepReadonly, OperationWorldView } from "./operations.js";

/**
 * LM-04: a rules-package-only boundary. This is never passed to a language model.
 * Engine semantics stay independent of package-defined mechanical vocabulary.
 */
export const semanticActionAttemptSchema = z.object({
  actionId: stableIdSchema,
  actorId: stableIdSchema,
  declaration: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  targetIds: z.array(stableIdSchema),
  modes: z.array(semanticActionModeSchema).min(1),
  statedMeans: z.array(z.string().trim().min(1)).max(8),
  pressureLevel: z.number().int().min(1).max(9),
  requestedHorizonMs: z.number().int().nonnegative(),
  authorizedHorizonMs: z.number().int().nonnegative(),
  remainingHorizonMs: z.number().int().nonnegative(),
}).strict();
export type SemanticActionAttempt = z.infer<typeof semanticActionAttemptSchema>;

export interface PrepareActionAttemptRequest {
  readonly operationId: string;
  readonly attempt: SemanticActionAttempt;
  readonly world: DeepReadonly<OperationWorldView>;
}

export type PreparedActionAttempt =
  | { readonly status: "not-applicable" }
  | {
      readonly status: "ready";
      readonly operationId: string;
      /** Package-authored and validated again against the operation schema. */
      readonly input: unknown;
      /** Developer-only: never use as actor-visible narration input. */
      readonly derivation: JsonValue;
    }
  | {
      readonly status: "missing-required-data";
      readonly required: readonly string[];
      readonly reason: string;
    }
  | { readonly status: "cannot-attempt"; readonly reason: string };

export type ActionAttemptPreparer =
  (request: PrepareActionAttemptRequest) => PreparedActionAttempt;

const preparedActionAttemptSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-applicable") }).strict(),
  z.object({
    status: z.literal("ready"),
    operationId: stableIdSchema,
    input: z.unknown(),
    derivation: jsonValueSchema,
  }).strict(),
  z.object({
    status: z.literal("missing-required-data"),
    required: z.array(z.string().trim().min(1)).min(1),
    reason: z.string().trim().min(1),
  }).strict(),
  z.object({
    status: z.literal("cannot-attempt"),
    reason: z.string().trim().min(1),
  }).strict(),
]);

export function validatePreparedActionAttempt(
  result: PreparedActionAttempt,
  requestedOperationId: string,
): PreparedActionAttempt {
  // Registration alone does not grant authority to return arbitrary shapes.
  preparedActionAttemptSchema.parse(result);
  if (result.status === "ready") {
    if (result.operationId !== requestedOperationId) {
      throw new Error("Ruleset preparer returned an unauthorized operation ID");
    }
    jsonValueSchema.parse(result.derivation);
  } else if (result.status === "missing-required-data") {
    if (!result.required.length || !result.reason.trim()) {
      throw new Error("Ruleset missing-mechanics response must name required fields");
    }
  } else if (result.status === "cannot-attempt" && !result.reason.trim()) {
    throw new Error("Ruleset cannot-attempt response must supply a reason");
  }
  return result;
}
