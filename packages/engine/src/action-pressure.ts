import { z } from "zod";
import { stableIdSchema } from "./identity.js";
import {
  fictionalDurationMs,
  fictionalDurationMsSchema,
  type FictionalDurationMs,
} from "./time.js";

export const actionPressureLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);
export type ActionPressureLevel = z.infer<typeof actionPressureLevelSchema>;

export const actionPressureStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unassessed") }).strict(),
  z
    .object({
      status: z.literal("assessed"),
      level: actionPressureLevelSchema,
    })
    .strict(),
]);
export type ActionPressureState = z.infer<typeof actionPressureStateSchema>;

export const actionPressureAssessmentSchema = z
  .object({ level: actionPressureLevelSchema })
  .strict();
export type ActionPressureAssessment = z.infer<
  typeof actionPressureAssessmentSchema
>;

const maximumHorizonByLevel: Readonly<
  Record<ActionPressureLevel, FictionalDurationMs>
> = Object.freeze({
  1: fictionalDurationMs(8 * 60 * 60 * 1_000),
  2: fictionalDurationMs(2 * 60 * 60 * 1_000),
  3: fictionalDurationMs(30 * 60 * 1_000),
  4: fictionalDurationMs(10 * 60 * 1_000),
  5: fictionalDurationMs(2 * 60 * 1_000),
  6: fictionalDurationMs(60 * 1_000),
  7: fictionalDurationMs(30 * 1_000),
  8: fictionalDurationMs(10 * 1_000),
  9: fictionalDurationMs(5 * 1_000),
});

export function maximumResolutionHorizon(
  level: ActionPressureLevel,
): FictionalDurationMs {
  return maximumHorizonByLevel[actionPressureLevelSchema.parse(level)];
}

const intentFields = {
  actorId: stableIdSchema,
  goal: z.string().trim().min(1),
  targetIds: z.array(stableIdSchema),
  requestedHorizonMs: fictionalDurationMsSchema,
};

export const interpretedIntentSchema = z.object(intentFields).strict();
export type InterpretedIntent = z.infer<typeof interpretedIntentSchema>;

export const executableIntentSchema = z
  .object({
    ...intentFields,
    pressureLevel: actionPressureLevelSchema,
    authorizedHorizonMs: fictionalDurationMsSchema,
    wasNarrowed: z.boolean(),
  })
  .strict();
export type ExecutableIntent = z.infer<typeof executableIntentSchema>;

export const intentStopReasonSchema = z.enum([
  "budget-exhausted",
  "goal-achieved",
  "goal-impossible",
  "material-circumstance-change",
  "model-turn-limit",
  "pressure-reassessment-required",
  "player-decision-required",
]);
export type IntentStopReason = z.infer<typeof intentStopReasonSchema>;

export class UnassessedActionPressureError extends Error {
  override readonly name = "UnassessedActionPressureError";

  constructor() {
    super("Action pressure must be assessed before intent can be bounded");
  }
}

export function boundInterpretedIntent(
  intent: InterpretedIntent,
  pressure: ActionPressureState,
): ExecutableIntent {
  const parsedIntent = interpretedIntentSchema.parse(intent);
  const parsedPressure = actionPressureStateSchema.parse(pressure);
  if (parsedPressure.status === "unassessed") {
    throw new UnassessedActionPressureError();
  }
  const authorizedHorizonMs = fictionalDurationMs(
    Math.min(
      parsedIntent.requestedHorizonMs,
      maximumResolutionHorizon(parsedPressure.level),
    ),
  );
  return executableIntentSchema.parse({
    ...parsedIntent,
    targetIds: [...parsedIntent.targetIds],
    pressureLevel: parsedPressure.level,
    authorizedHorizonMs,
    wasNarrowed: authorizedHorizonMs < parsedIntent.requestedHorizonMs,
  });
}
