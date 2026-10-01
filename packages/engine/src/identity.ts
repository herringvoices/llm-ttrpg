import { z } from "zod";

export const stableIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/,
    "IDs must be lowercase, stable, and dot/dash separated",
  );

export const versionSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    "Versions must use semantic-version form",
  );

export const componentIdentitySchema = z
  .object({
    id: stableIdSchema,
    version: versionSchema,
  })
  .strict();

export type ComponentIdentity = z.infer<typeof componentIdentitySchema>;
export type ComponentReference = ComponentIdentity;

export function sameComponent(
  actual: ComponentIdentity,
  expected: ComponentReference,
): boolean {
  return actual.id === expected.id && actual.version === expected.version;
}

