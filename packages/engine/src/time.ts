import { z } from "zod";

export type FictionalInstant = string & {
  readonly __fictionalInstant: "FictionalInstant";
};

export type FictionalDurationMs = number & {
  readonly __fictionalDurationMs: "FictionalDurationMs";
};

function normalizeInstant(value: string): FictionalInstant {
  return new Date(value).toISOString() as FictionalInstant;
}

export const fictionalInstantSchema = z
  .string()
  .datetime({ offset: true })
  .transform(normalizeInstant);

export const fictionalDurationMsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .transform((value) => value as FictionalDurationMs);

export function fictionalInstant(value: string): FictionalInstant {
  return fictionalInstantSchema.parse(value);
}

export function fictionalDurationMs(value: number): FictionalDurationMs {
  return fictionalDurationMsSchema.parse(value);
}

export function compareFictionalInstants(
  left: FictionalInstant,
  right: FictionalInstant,
): number {
  return Date.parse(left) - Date.parse(right);
}

export function advanceFictionalInstant(
  instant: FictionalInstant,
  duration: FictionalDurationMs,
): FictionalInstant {
  const next = Date.parse(instant) + duration;
  if (!Number.isSafeInteger(next)) {
    throw new RangeError("Fictional time advancement is outside the safe range");
  }
  return fictionalInstant(new Date(next).toISOString());
}
