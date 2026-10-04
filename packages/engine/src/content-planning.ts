import { z } from "zod";
import { contextQueryAuthorizationSchema } from "./context-contracts.js";
import { jsonValueSchema, type JsonValue } from "./json.js";
import { stableIdSchema } from "./identity.js";
import type { CanonicalEvent } from "./events.js";
import type { WorldState } from "./world.js";

export const situationSourcePatternSchema = z.enum([
  "authored-seed",
  "simulation-emergent",
  "query-driven-local-generation",
]);
export type SituationSourcePattern = z.infer<
  typeof situationSourcePatternSchema
>;

export const groundingRecordKindSchema = z.enum([
  "entity",
  "fact",
  "event",
  "belief",
  "document",
  "actor-social-state",
  "actor-goal",
  "actor-relationship",
  "actor-memory",
  "actor-commitment",
  "mechanical-realization",
  "scheduled-trigger",
  "simulation-scope",
  "world-process",
]);
export type GroundingRecordKind = z.infer<typeof groundingRecordKindSchema>;

const recordPathSegmentSchema = z.union([
  z.string().min(1),
  z.number().int().nonnegative(),
]);

export const groundingReferenceSchema = z.object({
  kind: groundingRecordKindSchema,
  id: stableIdSchema,
  path: z.array(recordPathSegmentSchema).min(1).optional(),
}).strict();
export type GroundingReference = z.infer<typeof groundingReferenceSchema>;

const canonicalCommitmentRecordKindSchema = groundingRecordKindSchema.exclude([
  "scheduled-trigger",
  "simulation-scope",
  "world-process",
]);

export const commitmentAssertionSchema = z.object({
  reference: groundingReferenceSchema.extend({
    kind: canonicalCommitmentRecordKindSchema,
  }).strict(),
  expectedValue: jsonValueSchema,
}).strict();
export type CommitmentAssertion = z.infer<typeof commitmentAssertionSchema>;

export const provisionalDetailSchema = z.object({
  id: stableIdSchema,
  summary: z.string().trim().min(1),
  durability: z.enum(["persistent", "presentation-only"]),
  constraints: z.array(groundingReferenceSchema).min(1),
  provenance: z.object({
    pattern: situationSourcePatternSchema,
    sourceIds: z.array(stableIdSchema),
    rationale: z.string().trim().min(1),
  }).strict(),
}).strict();
export type ProvisionalDetail = z.infer<typeof provisionalDetailSchema>;

export const commitmentEvidenceSchema = z.object({
  detailId: stableIdSchema,
  assertions: z.array(commitmentAssertionSchema).min(1),
}).strict();
export type CommitmentEvidence = z.infer<typeof commitmentEvidenceSchema>;

export const discoveryAffordanceKindSchema = z.enum([
  "observation",
  "conversation",
  "notice",
  "environmental-change",
  "institutional-contact",
  "rumor",
  "simulation-consequence",
]);

export const discoveryAffordanceSchema = z.object({
  id: stableIdSchema,
  kind: discoveryAffordanceKindSchema,
  gmSummary: z.string().trim().min(1),
  perspective: contextQueryAuthorizationSchema,
  grounding: z.array(groundingReferenceSchema).min(1),
  surfaceGrounding: z.array(groundingReferenceSchema).min(1),
  requiredDetailIds: z.array(stableIdSchema),
}).strict().superRefine((value, context) => {
  const grounding = new Set(value.grounding.map(groundingReferenceKey));
  for (const [index, reference] of value.surfaceGrounding.entries()) {
    if (!grounding.has(groundingReferenceKey(reference))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Surface grounding must also be listed as affordance grounding",
        path: ["surfaceGrounding", index],
      });
    }
  }
});
export type DiscoveryAffordance = z.infer<typeof discoveryAffordanceSchema>;

const conditionalDevelopmentSchema = z.object({
  summary: z.string().trim().min(1),
  grounding: z.array(groundingReferenceSchema).min(1),
}).strict();

export const situationCandidateSchema = z.object({
  id: stableIdSchema,
  sourcePattern: situationSourcePatternSchema,
  summary: z.string().trim().min(1),
  grounding: z.array(groundingReferenceSchema).min(1),
  provisionalDetailIds: z.array(stableIdSchema),
  conditionalDevelopments: z.array(conditionalDevelopmentSchema),
  discoveryAffordances: z.array(discoveryAffordanceSchema),
}).strict().superRefine((value, context) => {
  for (const [path, values] of [
    ["provisionalDetailIds", value.provisionalDetailIds],
    ["discoveryAffordances", value.discoveryAffordances.map((item) => item.id)],
  ] as const) {
    const seen = new Set<string>();
    for (const [index, id] of values.entries()) {
      if (seen.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate ${path} entry: ${id}`,
          path: [path, index],
        });
      }
      seen.add(id);
    }
  }
});
export type SituationCandidate = z.infer<typeof situationCandidateSchema>;

export const contentPlanningMaterialSchema = z.object({
  provisionalDetails: z.array(provisionalDetailSchema),
  commitmentEvidence: z.array(commitmentEvidenceSchema),
  candidates: z.array(situationCandidateSchema),
}).strict().superRefine((value, context) => {
  for (const [path, values] of [
    ["provisionalDetails", value.provisionalDetails.map((item) => item.id)],
    ["commitmentEvidence", value.commitmentEvidence.map((item) => item.detailId)],
    ["candidates", value.candidates.map((item) => item.id)],
  ] as const) {
    const seen = new Set<string>();
    for (const [index, id] of values.entries()) {
      if (seen.has(id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate ${path} entry: ${id}`,
          path: [path, index],
        });
      }
      seen.add(id);
    }
  }

  const detailIds = new Set(value.provisionalDetails.map((item) => item.id));
  for (const [index, evidence] of value.commitmentEvidence.entries()) {
    if (!detailIds.has(evidence.detailId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Commitment evidence references unknown detail ${evidence.detailId}`,
        path: ["commitmentEvidence", index, "detailId"],
      });
    }
  }
  for (const [candidateIndex, candidate] of value.candidates.entries()) {
    const candidateDetailIds = new Set(candidate.provisionalDetailIds);
    for (const [index, detailId] of candidate.provisionalDetailIds.entries()) {
      if (!detailIds.has(detailId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Candidate references unknown detail ${detailId}`,
          path: ["candidates", candidateIndex, "provisionalDetailIds", index],
        });
      }
    }
    for (const [affordanceIndex, affordance] of candidate.discoveryAffordances.entries()) {
      for (const [index, detailId] of affordance.requiredDetailIds.entries()) {
        if (!candidateDetailIds.has(detailId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `Affordance detail ${detailId} must belong to its situation candidate`,
            path: [
              "candidates",
              candidateIndex,
              "discoveryAffordances",
              affordanceIndex,
              "requiredDetailIds",
              index,
            ],
          });
        }
      }
    }
  }
});
export type ContentPlanningMaterial = z.infer<
  typeof contentPlanningMaterialSchema
>;

export interface AdditionalGroundingRecord {
  readonly reference: GroundingReference;
  readonly value: JsonValue;
}

export interface AuthoritativeGroundingCatalog {
  has(reference: GroundingReference): boolean;
  resolve(reference: GroundingReference): JsonValue | undefined;
  list(): readonly GroundingReference[];
}

export function groundingReferenceKey(reference: GroundingReference): string {
  const parsed = groundingReferenceSchema.parse(reference);
  return `${parsed.kind}:${parsed.id}${
    parsed.path ? `:${JSON.stringify(parsed.path)}` : ""
  }`;
}

function recordKey(reference: Pick<GroundingReference, "kind" | "id">): string {
  return `${reference.kind}:${reference.id}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function valueAtPath(
  value: unknown,
  path: readonly (string | number)[] | undefined,
): { readonly found: boolean; readonly value?: unknown } {
  let current = value;
  for (const segment of path ?? []) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) return { found: false };
      current = current[segment];
      continue;
    }
    if (
      current === null || typeof current !== "object" || Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

export function createAuthoritativeGroundingCatalog(
  world: WorldState,
  events: readonly CanonicalEvent[] = [],
  additional: readonly AdditionalGroundingRecord[] = [],
): AuthoritativeGroundingCatalog {
  const records = new Map<string, JsonValue>();
  const add = (kind: GroundingRecordKind, id: string, value: unknown): void => {
    records.set(recordKey({ kind, id }), jsonValueSchema.parse(clone(value)));
  };

  for (const entity of world.entities) add("entity", entity.id, entity);
  for (const fact of world.facts) add("fact", fact.id, fact);
  for (const event of events) add("event", event.id, event);
  for (const belief of world.beliefs) add("belief", belief.id, belief);
  for (const document of world.documents) add("document", document.id, document);
  for (const social of world.actorSocialStates) {
    add("actor-social-state", social.actorId, social);
    for (const goal of social.goals) add("actor-goal", goal.id, goal);
    for (const relationship of social.relationships) {
      add("actor-relationship", relationship.id, relationship);
    }
    for (const memory of social.memories) add("actor-memory", memory.id, memory);
    for (const commitment of social.commitments) {
      add("actor-commitment", commitment.id, commitment);
    }
  }
  for (const realization of world.mechanicalRealizations) {
    add("mechanical-realization", realization.entityId, realization);
  }
  for (const trigger of world.scheduledTriggers) {
    add("scheduled-trigger", trigger.id, trigger);
  }
  for (const cursor of world.simulationCursors) {
    add("simulation-scope", cursor.scopeId, cursor);
  }
  for (const item of additional) {
    const reference = groundingReferenceSchema.parse(item.reference);
    if (reference.path) {
      throw new Error("Additional grounding records must identify a record root");
    }
    add(reference.kind, reference.id, item.value);
  }

  const resolve = (referenceValue: GroundingReference): JsonValue | undefined => {
    const reference = groundingReferenceSchema.parse(referenceValue);
    const record = records.get(recordKey(reference));
    if (record === undefined) return undefined;
    const selected = valueAtPath(record, reference.path);
    if (!selected.found) return undefined;
    return jsonValueSchema.parse(clone(selected.value));
  };

  return {
    has(reference) {
      return resolve(reference) !== undefined;
    },
    resolve,
    list() {
      return [...records.keys()].sort().map((key) => {
        const separator = key.indexOf(":");
        return groundingReferenceSchema.parse({
          kind: key.slice(0, separator),
          id: key.slice(separator + 1),
        });
      });
    },
  };
}

export const contentPlanningIssueSchema = z.object({
  code: stableIdSchema,
  message: z.string().trim().min(1),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
}).strict();
export type ContentPlanningIssue = z.infer<typeof contentPlanningIssueSchema>;

export const situationGroundingAssessmentSchema = z.object({
  candidateId: stableIdSchema,
  grounded: z.boolean(),
  issues: z.array(contentPlanningIssueSchema),
}).strict();
export type SituationGroundingAssessment = z.infer<
  typeof situationGroundingAssessmentSchema
>;

function issue(
  code: string,
  message: string,
  path: readonly (string | number)[],
): ContentPlanningIssue {
  return contentPlanningIssueSchema.parse({ code, message, path });
}

function missingGroundingIssues(
  catalog: AuthoritativeGroundingCatalog,
  references: readonly GroundingReference[],
  path: readonly (string | number)[],
): ContentPlanningIssue[] {
  return references.flatMap((reference, index) =>
    catalog.has(reference)
      ? []
      : [issue(
          "content.grounding.missing",
          `Missing authoritative grounding ${groundingReferenceKey(reference)}`,
          [...path, index],
        )]
  );
}

export function assessSituationCandidateGrounding(
  candidateValue: unknown,
  materialValue: unknown,
  catalog: AuthoritativeGroundingCatalog,
): SituationGroundingAssessment {
  const candidate = situationCandidateSchema.parse(candidateValue);
  const material = contentPlanningMaterialSchema.parse(materialValue);
  const details = new Map(material.provisionalDetails.map((item) => [item.id, item]));
  const issues: ContentPlanningIssue[] = [];
  issues.push(...missingGroundingIssues(catalog, candidate.grounding, ["grounding"]));

  for (const [index, detailId] of candidate.provisionalDetailIds.entries()) {
    const detail = details.get(detailId);
    if (!detail) {
      issues.push(issue(
        "content.detail.missing",
        `Candidate references unknown provisional detail ${detailId}`,
        ["provisionalDetailIds", index],
      ));
      continue;
    }
    issues.push(...missingGroundingIssues(
      catalog,
      detail.constraints,
      ["provisionalDetails", detailId, "constraints"],
    ));
  }
  for (const [index, development] of candidate.conditionalDevelopments.entries()) {
    issues.push(...missingGroundingIssues(
      catalog,
      development.grounding,
      ["conditionalDevelopments", index, "grounding"],
    ));
  }
  for (const [index, affordance] of candidate.discoveryAffordances.entries()) {
    issues.push(...missingGroundingIssues(
      catalog,
      affordance.grounding,
      ["discoveryAffordances", index, "grounding"],
    ));
    for (const [detailIndex, detailId] of affordance.requiredDetailIds.entries()) {
      if (!details.has(detailId)) {
        issues.push(issue(
          "content.detail.missing",
          `Affordance references unknown provisional detail ${detailId}`,
          ["discoveryAffordances", index, "requiredDetailIds", detailIndex],
        ));
      }
    }
  }
  return situationGroundingAssessmentSchema.parse({
    candidateId: candidate.id,
    grounded: issues.length === 0,
    issues,
  });
}

function evidenceIsEstablished(
  evidence: CommitmentEvidence,
  catalog: AuthoritativeGroundingCatalog,
): boolean {
  return evidence.assertions.every((assertion) => {
    const actual = catalog.resolve(assertion.reference);
    return actual !== undefined &&
      JSON.stringify(actual) === JSON.stringify(assertion.expectedValue);
  });
}

export function committedDetailEstablishingReferences(
  detailId: string,
  materialValue: unknown,
  catalog: AuthoritativeGroundingCatalog,
): readonly GroundingReference[] {
  const material = contentPlanningMaterialSchema.parse(materialValue);
  const detail = material.provisionalDetails.find((item) => item.id === detailId);
  if (!detail || detail.durability !== "persistent") return [];
  const evidence = material.commitmentEvidence.find((item) =>
    item.detailId === detailId
  );
  if (!evidence || !evidenceIsEstablished(evidence, catalog)) return [];
  return evidence.assertions.map((item) => clone(item.reference));
}

export const perspectiveGroundingAccessSchema = z.object({
  authorization: contextQueryAuthorizationSchema,
  affordanceLocalRef: stableIdSchema,
  references: z.array(z.object({
    reference: groundingReferenceSchema,
    localRef: stableIdSchema,
  }).strict()),
}).strict().superRefine((value, context) => {
  for (const [label, values] of [
    ["reference", value.references.map((item) => groundingReferenceKey(item.reference))],
    ["local reference", value.references.map((item) => item.localRef)],
  ] as const) {
    const seen = new Set<string>();
    for (const [index, item] of values.entries()) {
      if (seen.has(item)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate perspective ${label}: ${item}`,
          path: ["references", index],
        });
      }
      seen.add(item);
    }
  }
});
export type PerspectiveGroundingAccess = z.infer<
  typeof perspectiveGroundingAccessSchema
>;

export const discoveryReadinessAssessmentSchema = z.object({
  affordanceId: stableIdSchema,
  ready: z.boolean(),
  unresolvedDetailIds: z.array(stableIdSchema),
  inaccessibleGrounding: z.array(groundingReferenceSchema),
  issues: z.array(contentPlanningIssueSchema),
}).strict();
export type DiscoveryReadinessAssessment = z.infer<
  typeof discoveryReadinessAssessmentSchema
>;

function sameAuthorization(left: unknown, right: unknown): boolean {
  return JSON.stringify(
    contextQueryAuthorizationSchema.parse(left),
  ) === JSON.stringify(contextQueryAuthorizationSchema.parse(right));
}

function findAffordance(
  candidate: SituationCandidate,
  affordanceId: string,
): DiscoveryAffordance {
  const affordance = candidate.discoveryAffordances.find((item) =>
    item.id === affordanceId
  );
  if (!affordance) {
    throw new ContentPlanningValidationError(
      `Unknown discovery affordance ${affordanceId} on ${candidate.id}`,
    );
  }
  return affordance;
}

export function assessDiscoveryAffordanceReadiness(
  candidateValue: unknown,
  affordanceId: string,
  materialValue: unknown,
  catalog: AuthoritativeGroundingCatalog,
  accessValue: unknown,
): DiscoveryReadinessAssessment {
  const candidate = situationCandidateSchema.parse(candidateValue);
  const material = contentPlanningMaterialSchema.parse(materialValue);
  const access = perspectiveGroundingAccessSchema.parse(accessValue);
  const affordance = findAffordance(candidate, affordanceId);
  const details = new Map(material.provisionalDetails.map((item) => [item.id, item]));
  const issues = [...assessSituationCandidateGrounding(
    candidate,
    material,
    catalog,
  ).issues];
  if (!sameAuthorization(affordance.perspective, access.authorization)) {
    issues.push(issue(
      "content.perspective.mismatch",
      "Perspective grounding was produced for a different authorization",
      ["perspective"],
    ));
  }

  const unresolvedDetailIds = affordance.requiredDetailIds.filter((detailId) => {
    const detail = details.get(detailId);
    return !detail || (
      detail.durability === "persistent" &&
      committedDetailEstablishingReferences(detailId, material, catalog).length === 0
    );
  });
  for (const detailId of unresolvedDetailIds) {
    issues.push(issue(
      "content.detail.uncommitted",
      `Discovery affordance depends on uncommitted persistent detail ${detailId}`,
      ["requiredDetailIds"],
    ));
  }

  const accessible = new Set(access.references.map((item) =>
    groundingReferenceKey(item.reference)
  ));
  const inaccessibleGrounding = affordance.surfaceGrounding.filter((reference) =>
    !accessible.has(groundingReferenceKey(reference))
  );
  for (const reference of inaccessibleGrounding) {
    issues.push(issue(
      "content.perspective.inaccessible",
      `Perspective cannot receive ${groundingReferenceKey(reference)}`,
      ["surfaceGrounding"],
    ));
  }

  return discoveryReadinessAssessmentSchema.parse({
    affordanceId: affordance.id,
    ready: issues.length === 0,
    unresolvedDetailIds,
    inaccessibleGrounding,
    issues,
  });
}

export const preparedDiscoveryAffordanceSchema = z.object({
  affordanceRef: stableIdSchema,
  kind: discoveryAffordanceKindSchema,
  surfaceRefs: z.array(stableIdSchema).min(1),
}).strict();
export type PreparedDiscoveryAffordance = z.infer<
  typeof preparedDiscoveryAffordanceSchema
>;

export class ContentPlanningValidationError extends Error {
  override readonly name = "ContentPlanningValidationError";
}

export function prepareDiscoveryAffordance(
  candidateValue: unknown,
  affordanceId: string,
  materialValue: unknown,
  catalog: AuthoritativeGroundingCatalog,
  accessValue: unknown,
): PreparedDiscoveryAffordance {
  const candidate = situationCandidateSchema.parse(candidateValue);
  const access = perspectiveGroundingAccessSchema.parse(accessValue);
  const affordance = findAffordance(candidate, affordanceId);
  const assessment = assessDiscoveryAffordanceReadiness(
    candidate,
    affordanceId,
    materialValue,
    catalog,
    access,
  );
  if (!assessment.ready) {
    throw new ContentPlanningValidationError(
      assessment.issues.map((item) => item.message).join("; "),
    );
  }
  const localRefs = new Map(access.references.map((item) => [
    groundingReferenceKey(item.reference),
    item.localRef,
  ]));
  return preparedDiscoveryAffordanceSchema.parse({
    affordanceRef: access.affordanceLocalRef,
    kind: affordance.kind,
    surfaceRefs: affordance.surfaceGrounding.map((reference) =>
      localRefs.get(groundingReferenceKey(reference))!
    ),
  });
}
