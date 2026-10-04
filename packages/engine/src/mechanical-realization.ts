import { z } from "zod";
import { componentIdentitySchema, stableIdSchema } from "./identity.js";
import { fictionalInstantSchema } from "./time.js";

export const mechanicalRealizationLevelSchema = z.enum([
  "unrealized",
  "constrained",
  "partial",
  "complete",
]);
export type MechanicalRealizationLevel = z.infer<
  typeof mechanicalRealizationLevelSchema
>;

const realizationRanks: Readonly<Record<MechanicalRealizationLevel, number>> = {
  unrealized: 0,
  constrained: 1,
  partial: 2,
  complete: 3,
};

export const mechanicalConstraintSourceSchema = z.enum([
  "canonical-fact",
  "canonical-event",
  "entity",
  "setting",
  "campaign",
  "observation",
  "threat-envelope",
  "player-established",
  "real-world-anchor",
]);

export const mechanicalConstraintSchema = z.object({
  id: stableIdSchema,
  sourceKind: mechanicalConstraintSourceSchema,
  sourceId: stableIdSchema,
  summary: z.string().trim().min(1),
}).strict();
export type MechanicalConstraint = z.infer<typeof mechanicalConstraintSchema>;

export const mechanicalRealizationStepSchema = z.object({
  id: stableIdSchema,
  occurredAt: fictionalInstantSchema,
  fromLevel: mechanicalRealizationLevelSchema,
  toLevel: mechanicalRealizationLevelSchema,
  sourceComponent: componentIdentitySchema,
  generatorVersion: z.string().trim().min(1),
  addedPaths: z.array(z.string().trim().min(1)),
  constraintIds: z.array(stableIdSchema),
  reason: z.string().trim().min(1),
}).strict().superRefine((step, context) => {
  if (realizationRanks[step.toLevel] < realizationRanks[step.fromLevel]) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A realization step cannot reduce specificity",
      path: ["toLevel"],
    });
  }
});
export type MechanicalRealizationStep = z.infer<
  typeof mechanicalRealizationStepSchema
>;

export const mechanicalRealizationSchema = z.object({
  entityId: stableIdSchema,
  level: mechanicalRealizationLevelSchema,
  constraints: z.array(mechanicalConstraintSchema),
  history: z.array(mechanicalRealizationStepSchema),
}).strict().superRefine((value, context) => {
  for (const [label, values] of [
    ["constraint", value.constraints],
    ["history", value.history],
  ] as const) {
    const seen = new Set<string>();
    for (const [index, item] of values.entries()) {
      if (seen.has(item.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate ${label} ID: ${item.id}`,
          path: [label === "constraint" ? "constraints" : "history", index, "id"],
        });
      }
      seen.add(item.id);
    }
  }
});
export type MechanicalRealization = z.infer<typeof mechanicalRealizationSchema>;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireAppendOnlyById<T extends { readonly id: string }>(
  previous: readonly T[],
  next: readonly T[],
  label: string,
): void {
  const nextById = new Map(next.map((item) => [item.id, item]));
  for (const item of previous) {
    const replacement = nextById.get(item.id);
    if (!replacement || !sameJson(replacement, item)) {
      throw new Error(`${label} ${item.id} cannot be removed or rewritten`);
    }
  }
}

export function validateMechanicalRealizationUpdate(
  previous: MechanicalRealization | undefined,
  candidate: MechanicalRealization,
): MechanicalRealization {
  const next = mechanicalRealizationSchema.parse(candidate);
  if (!previous) return next;
  const current = mechanicalRealizationSchema.parse(previous);
  if (current.entityId !== next.entityId) {
    throw new Error("Mechanical realization cannot change entity identity");
  }
  if (realizationRanks[next.level] < realizationRanks[current.level]) {
    throw new Error(
      `Mechanical realization cannot regress from ${current.level} to ${next.level}`,
    );
  }
  requireAppendOnlyById(current.constraints, next.constraints, "Constraint");
  requireAppendOnlyById(current.history, next.history, "Realization step");
  return next;
}

function assertJsonExtensionAtPath(
  previous: unknown,
  next: unknown,
  path: string,
): void {
  if (previous === null || typeof previous !== "object") {
    if (!sameJson(previous, next)) {
      throw new Error(`Mechanical densification would retcon ${path || "existing data"}`);
    }
    return;
  }
  if (Array.isArray(previous)) {
    if (!Array.isArray(next)) {
      throw new Error(`Mechanical densification changed the type at ${path}`);
    }
    const keyed = previous.every(
      (item) => item && typeof item === "object" && !Array.isArray(item) &&
        typeof (item as { id?: unknown }).id === "string",
    );
    if (keyed) {
      const nextById = new Map(
        next
          .filter((item) => item && typeof item === "object" && !Array.isArray(item))
          .map((item) => [(item as { id?: string }).id, item]),
      );
      for (const item of previous as Array<{ id: string }>) {
        const replacement = nextById.get(item.id);
        if (replacement === undefined) {
          throw new Error(`Mechanical densification removed ${path}[${item.id}]`);
        }
        assertJsonExtensionAtPath(item, replacement, `${path}[${item.id}]`);
      }
      return;
    }
    if (previous.length > (next as unknown[]).length) {
      throw new Error(`Mechanical densification removed values from ${path}`);
    }
    for (let index = 0; index < previous.length; index += 1) {
      assertJsonExtensionAtPath(
        previous[index],
        (next as unknown[])[index],
        `${path}[${index}]`,
      );
    }
    return;
  }
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    throw new Error(`Mechanical densification changed the type at ${path}`);
  }
  for (const [key, value] of Object.entries(previous)) {
    if (!(key in (next as Record<string, unknown>))) {
      throw new Error(`Mechanical densification removed ${path ? `${path}.` : ""}${key}`);
    }
    assertJsonExtensionAtPath(
      value,
      (next as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
    );
  }
}

export function assertNoRetconJsonExtension(
  previous: unknown,
  next: unknown,
): void {
  if (previous === undefined) return;
  assertJsonExtensionAtPath(previous, next, "");
}
