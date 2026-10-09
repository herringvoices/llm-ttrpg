import { z } from "zod";
import { stableIdSchema } from "./identity.js";
import type { WorldState } from "./world.js";
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


/** A read-only, version-independent basis over *pressure-relevant* canonical
 * state. Routine world revision or dialogue does not enter the fingerprint. */
export function scenePressureSources(
  world: Pick<WorldState, "facts" | "scheduledTriggers" | "fictionalTime">,
  actorId: string,
  locationId?: string,
): { readonly fingerprint: string; readonly level?: ActionPressureLevel;
     readonly deadlineMs?: FictionalDurationMs; readonly sourceCount: number } {
  const scopes = new Set([actorId, ...(locationId ? [locationId] : [])]);
  const facts = world.facts.filter((fact) =>
    scopes.has(fact.subjectId) &&
    ["scene.action-pressure", "environment.action-pressure", "actor.action-pressure"].includes(fact.predicate)
  ).map((fact) => {
    const value = typeof fact.value === "number" ? fact.value :
      fact.value && typeof fact.value === "object" && !Array.isArray(fact.value)
        ? fact.value.level : undefined;
    return { id: fact.id, level: actionPressureLevelSchema.safeParse(value).success
      ? actionPressureLevelSchema.parse(value) : undefined, source: fact.value };
  });
  const now = Date.parse(world.fictionalTime);
  const deadlines = world.scheduledTriggers.filter((trigger) =>
    trigger.scopeIds.some((scope) => scopes.has(scope)) &&
    Date.parse(trigger.dueAt) - now <= maximumResolutionHorizon(1)
  ).map((trigger) => ({ id: trigger.id, dueAt: trigger.dueAt,
    remainingMs: Math.max(0, Date.parse(trigger.dueAt) - now) }));
  const factLevel = [...facts].reverse().find((fact) => fact.level !== undefined)?.level;
  const imminent = deadlines.reduce<ActionPressureLevel | undefined>((acc, deadline) => {
    const level: ActionPressureLevel = deadline.remainingMs <= 5_000 ? 9
      : deadline.remainingMs <= 10_000 ? 8
      : deadline.remainingMs <= 30_000 ? 7
      : deadline.remainingMs <= 60_000 ? 6 : 1;
    return acc === undefined || level > acc ? level : acc;
  }, undefined);
  return {
    // Time isn't part of the fingerprint except where a deadline crosses a
    // meaningful pressure band. No spurious revision on every ordinary turn.
    fingerprint: JSON.stringify({
      locationId: locationId ?? null, facts,
      deadlines: deadlines.map((deadline) => ({
        id: deadline.id,
        band: deadline.remainingMs <= 5_000 ? 9 :
          deadline.remainingMs <= 10_000 ? 8 :
          deadline.remainingMs <= 30_000 ? 7 :
          deadline.remainingMs <= 60_000 ? 6 : 1,
      })),
    }),
    ...(imminent || factLevel ? { level: imminent === undefined ? factLevel
      : factLevel === undefined ? imminent : Math.max(imminent, factLevel) as ActionPressureLevel } : {}),
    ...(deadlines.length ? { deadlineMs: fictionalDurationMs(
      Math.min(...deadlines.map((deadline) => deadline.remainingMs))) } : {}),
    sourceCount: facts.length + deadlines.length,
  };
}

/** A prior assessed level in an old save stays authoritative until an actual
 * pressure source transition. An unassessed first scene may use one bounded
 * interpretation; known hazards always take precedence over that guess. */
export function chooseScenePressure(
  pressure: ActionPressureState,
  sources: ReturnType<typeof scenePressureSources>,
  proposal: ActionPressureLevel,
  previous?: ReturnType<typeof scenePressureSources>,
): { readonly level: ActionPressureLevel; readonly reason:
    "authoritative-source" | "source-ended" | "scene-reused" | "initial-assessment" } {
  if (sources.level !== undefined) return { level: sources.level, reason: "authoritative-source" };
  if (pressure.status === "assessed") {
    if (previous && previous.fingerprint !== sources.fingerprint &&
        previous.sourceCount > 0) {
      return { level: 3, reason: "source-ended" };
    }
    return { level: pressure.level, reason: "scene-reused" };
  }
  return { level: proposal, reason: "initial-assessment" };
}

/** Explicit time is a player-authored intention, never permission to bypass
 * Action Pressure. Unmentioned duration remains a rules/model estimate. */
export function declaredDurationMs(declaration: string): FictionalDurationMs | undefined {
  if (/\b(?:all|the whole|spend the|spent the|for the) (?:morning|afternoon|evening)\b/i.test(declaration)) {
    return fictionalDurationMs(4 * 60 * 60_000);
  }
  if (/\b(?:all|the whole) day\b/i.test(declaration)) {
    return fictionalDurationMs(8 * 60 * 60_000);
  }
  const matched = /\b(?:for|spend|spent|over|during)\s+(?:(?:about|roughly|around|approximately)\s+)?(\d{1,3}|an?|one|two|three|four|five|six|half)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i.exec(declaration);
  if (!matched) return undefined;
  const word = matched[1]!.toLowerCase();
  const count = Number(word);
  const amount = Number.isFinite(count) ? count :
    ({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4,
      five: 5, six: 6, half: 0.5 } as Record<string, number>)[word];
  if (amount === undefined) return undefined;
  const unit = matched[2]!.toLowerCase();
  const multiplier = unit.startsWith("sec") ? 1_000 :
    unit.startsWith("min") ? 60_000 : 3_600_000;
  return fictionalDurationMs(Math.round(amount * multiplier));
}
