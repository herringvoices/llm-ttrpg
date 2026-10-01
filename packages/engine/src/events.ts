import { z } from "zod";
import { jsonValueSchema, type JsonValue } from "./json.js";
import {
  componentIdentitySchema,
  stableIdSchema,
  type ComponentIdentity,
} from "./identity.js";
import { fictionalInstantSchema } from "./time.js";

export const eventAccessSchema = z.enum(["public", "gm-only"]);
export type EventAccess = z.infer<typeof eventAccessSchema>;

export const eventOriginSchema = z
  .object({
    kind: stableIdSchema,
    id: stableIdSchema.optional(),
  })
  .strict();
export type EventOrigin = z.infer<typeof eventOriginSchema>;

export const authoredEventSchema = z
  .object({
    id: stableIdSchema,
    type: stableIdSchema,
    schemaVersion: z.number().int().positive(),
    occurredAt: fictionalInstantSchema,
    relatedEntityIds: z.array(stableIdSchema),
    scopeIds: z.array(stableIdSchema),
    causedByEventIds: z.array(stableIdSchema),
    origin: eventOriginSchema.optional(),
    summary: z.string().min(1),
    payload: jsonValueSchema,
    access: eventAccessSchema,
  })
  .strict();
export type AuthoredEvent = z.infer<typeof authoredEventSchema>;

export const canonicalEventSchema = authoredEventSchema
  .extend({
    sourceComponent: componentIdentitySchema,
    sequence: z.number().int().positive(),
  })
  .strict();
export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;

export interface EventTypeDefinition<TPayload extends JsonValue = JsonValue> {
  readonly type: string;
  readonly schemaVersion: number;
  readonly payloadSchema: z.ZodType<TPayload>;
}

// Package event registries are intentionally heterogeneous; validation restores
// the concrete payload type at the package boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegisteredEventType = EventTypeDefinition<any>;

export interface ResolvedEventType extends RegisteredEventType {
  readonly sourceComponent: ComponentIdentity;
}

export interface EventTypeRegistry {
  resolve(type: string, schemaVersion: number): ResolvedEventType;
  validatePayload(
    type: string,
    schemaVersion: number,
    payload: unknown,
  ): JsonValue;
}

export class EventValidationError extends Error {
  override readonly name = "EventValidationError";
}

function isZodSchema(value: unknown): value is z.ZodType<JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    "safeParse" in value &&
    typeof value.safeParse === "function"
  );
}

export function createEventTypeRegistry(
  components: readonly {
    readonly identity: ComponentIdentity;
    readonly eventTypes: readonly RegisteredEventType[];
  }[],
): EventTypeRegistry {
  const definitions = new Map<string, ResolvedEventType>();

  for (const component of components) {
    for (const candidate of component.eventTypes) {
      const type = stableIdSchema.parse(candidate.type);
      const schemaVersion = z.number().int().positive().parse(candidate.schemaVersion);
      if (!isZodSchema(candidate.payloadSchema)) {
        throw new EventValidationError(
          `Event type ${type}@${schemaVersion} must provide a Zod payload schema`,
        );
      }
      const key = `${type}@${schemaVersion}`;
      if (definitions.has(key)) {
        throw new EventValidationError(`Duplicate event type: ${key}`);
      }
      definitions.set(key, {
        type,
        schemaVersion,
        payloadSchema: candidate.payloadSchema,
        sourceComponent: { ...component.identity },
      });
    }
  }

  const resolve = (type: string, schemaVersion: number): ResolvedEventType => {
    const definition = definitions.get(`${type}@${schemaVersion}`);
    if (!definition) {
      throw new EventValidationError(
        `Unregistered event type: ${type}@${schemaVersion}`,
      );
    }
    return definition;
  };

  return {
    resolve,
    validatePayload(type, schemaVersion, payload) {
      return resolve(type, schemaVersion).payloadSchema.parse(payload) as JsonValue;
    },
  };
}

export const eventCursorSchema = z
  .object({
    occurredAt: fictionalInstantSchema,
    sequence: z.number().int().positive(),
  })
  .strict();
export type EventCursor = z.infer<typeof eventCursorSchema>;

export const eventQuerySchema = z
  .object({
    from: fictionalInstantSchema.optional(),
    to: fictionalInstantSchema.optional(),
    types: z.array(stableIdSchema).min(1).optional(),
    relatedEntityId: stableIdSchema.optional(),
    scopeId: stableIdSchema.optional(),
    causedByEventId: stableIdSchema.optional(),
    originKind: stableIdSchema.optional(),
    originId: stableIdSchema.optional(),
    access: z.array(eventAccessSchema).min(1).optional(),
    direction: z.enum(["ascending", "descending"]).optional(),
    cursor: eventCursorSchema.optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.from && query.to && query.from > query.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Event query start must not be later than its end",
        path: ["from"],
      });
    }
  });
export type EventQuery = z.infer<typeof eventQuerySchema>;
