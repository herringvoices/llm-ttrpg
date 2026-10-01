import { z } from "zod";
import { stableIdSchema } from "./identity.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const visibilitySchema = z.enum(["public", "hidden"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const entitySchema = z
  .object({
    id: stableIdSchema,
    kind: stableIdSchema,
    name: z.string().min(1),
    summary: z.string().min(1),
    data: z.record(jsonValueSchema),
  })
  .strict();
export type Entity = z.infer<typeof entitySchema>;

export const canonicalFactSchema = z
  .object({
    id: stableIdSchema,
    subjectId: stableIdSchema,
    predicate: stableIdSchema,
    value: jsonValueSchema,
    visibility: visibilitySchema,
    tags: z.array(stableIdSchema),
  })
  .strict();
export type CanonicalFact = z.infer<typeof canonicalFactSchema>;

export const canonicalEventSchema = z
  .object({
    id: stableIdSchema,
    kind: stableIdSchema,
    occurredAt: z.string().datetime(),
    summary: z.string().min(1),
    participantIds: z.array(stableIdSchema),
    details: z.record(jsonValueSchema),
    visibility: visibilitySchema,
  })
  .strict();
export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;

export const documentMetadataSchema = z
  .object({
    title: z.string().min(1),
    kind: stableIdSchema,
    authors: z.array(z.string().min(1)),
    tags: z.array(stableIdSchema),
    relatedEntityIds: z.array(stableIdSchema),
    visibility: visibilitySchema,
    publishedAt: z.string().datetime().optional(),
  })
  .strict();
export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;

export const documentSectionSchema = z
  .object({
    id: stableIdSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    content: z.string().min(1),
  })
  .strict();
export type DocumentSection = z.infer<typeof documentSectionSchema>;

export const longFormDocumentSchema = z
  .object({
    id: stableIdSchema,
    metadata: documentMetadataSchema,
    summary: z.string().min(1),
    sections: z.array(documentSectionSchema).min(1),
  })
  .strict()
  .superRefine((document, context) => {
    const ids = new Set<string>();
    for (const section of document.sections) {
      if (ids.has(section.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate section ID: ${section.id}`,
          path: ["sections"],
        });
      }
      ids.add(section.id);
    }
  });
export type LongFormDocument = z.infer<typeof longFormDocumentSchema>;

export const beliefTruthStatusSchema = z.enum([
  "true",
  "incomplete",
  "uncertain",
  "false",
]);
export type BeliefTruthStatus = z.infer<typeof beliefTruthStatusSchema>;

export const beliefHolderSchema = z
  .object({
    kind: z.enum(["actor", "group"]),
    id: stableIdSchema,
  })
  .strict();
export type BeliefHolder = z.infer<typeof beliefHolderSchema>;

export const beliefSchema = z
  .object({
    id: stableIdSchema,
    holder: beliefHolderSchema,
    subjectId: stableIdSchema,
    proposition: z.string().min(1),
    truthStatus: beliefTruthStatusSchema,
    confidence: z.number().min(0).max(1),
    sourceFactId: stableIdSchema.optional(),
  })
  .strict();
export type Belief = z.infer<typeof beliefSchema>;

export const contentBundleSchema = z
  .object({
    entities: z.array(entitySchema),
    facts: z.array(canonicalFactSchema),
    events: z.array(canonicalEventSchema),
    documents: z.array(longFormDocumentSchema),
    beliefs: z.array(beliefSchema),
  })
  .strict();
export type ContentBundle = z.infer<typeof contentBundleSchema>;

export function emptyContentBundle(): ContentBundle {
  return {
    entities: [],
    facts: [],
    events: [],
    documents: [],
    beliefs: [],
  };
}
