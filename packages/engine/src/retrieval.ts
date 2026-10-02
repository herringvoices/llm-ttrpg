import type {
  Belief,
  CanonicalFact,
  DocumentMetadata,
  DocumentSection,
  LongFormDocument,
} from "./content.js";
import type { LoadedGameDefinition } from "./contracts.js";
import type { WorldState } from "./world.js";
import type { CanonicalEvent, EventQuery } from "./events.js";
import type { EventHistoryStore, WorldId } from "./persistence.js";
import type { ModelRole } from "./context-contracts.js";

export type Perspective =
  | { readonly kind: "canonical" }
  | { readonly kind: "actor" | "group"; readonly id: string };

export interface KnowledgeQuery {
  readonly subjectId?: string;
  readonly tags?: readonly string[];
}

export type RetrievedBelief = Pick<
  Belief,
  "id" | "holder" | "subjectId" | "proposition" | "confidence"
>;

export interface RetrievedKnowledge {
  readonly facts: readonly CanonicalFact[];
  readonly beliefs: readonly RetrievedBelief[];
}

function factMatches(fact: CanonicalFact, query: KnowledgeQuery): boolean {
  if (query.subjectId && fact.subjectId !== query.subjectId) {
    return false;
  }
  if (
    query.tags &&
    query.tags.length > 0 &&
    !query.tags.some((tag) => fact.tags.includes(tag))
  ) {
    return false;
  }
  return true;
}

export function retrieveKnowledge(
  game: LoadedGameDefinition,
  world: WorldState,
  perspective: Perspective,
  query: KnowledgeQuery = {},
): RetrievedKnowledge {
  const facts = [...game.setting.content.facts, ...world.facts].filter(
    (fact) =>
      (perspective.kind === "canonical" || fact.visibility === "public") &&
      factMatches(fact, query),
  );

  const beliefs =
    perspective.kind === "canonical"
      ? []
      : world.beliefs
          .filter(
            (belief) =>
              belief.holder.kind === perspective.kind &&
              belief.holder.id === perspective.id &&
              (!query.subjectId || belief.subjectId === query.subjectId),
          )
          .map(
            ({ id, holder, subjectId, proposition, confidence }) => ({
              id,
              holder,
              subjectId,
              proposition,
              confidence,
            }),
          );

  return { facts, beliefs };
}

export type DocumentRetrievalRequest =
  | { readonly level: "metadata" }
  | { readonly level: "summary" }
  | { readonly level: "section"; readonly sectionId: string }
  | { readonly level: "full" };

export type DocumentRetrievalResult =
  | {
      readonly level: "metadata";
      readonly id: string;
      readonly metadata: DocumentMetadata;
    }
  | {
      readonly level: "summary";
      readonly id: string;
      readonly metadata: DocumentMetadata;
      readonly summary: string;
      readonly sections: readonly Pick<DocumentSection, "id" | "title" | "summary">[];
    }
  | {
      readonly level: "section";
      readonly id: string;
      readonly metadata: DocumentMetadata;
      readonly summary: string;
      readonly section: DocumentSection;
    }
  | {
      readonly level: "full";
      readonly document: LongFormDocument;
    };

export class RetrievalError extends Error {
  override readonly name = "RetrievalError";
}

export function retrieveDocument(
  game: LoadedGameDefinition,
  world: WorldState,
  perspective: Perspective,
  documentId: string,
  request: DocumentRetrievalRequest,
): DocumentRetrievalResult {
  const document = [...game.setting.content.documents, ...world.documents].find(
    (candidate) => candidate.id === documentId,
  );
  if (!document) {
    throw new RetrievalError(`Unknown document: ${documentId}`);
  }
  if (
    document.metadata.visibility === "hidden" &&
    perspective.kind !== "canonical"
  ) {
    throw new RetrievalError(`Document is not available to this perspective`);
  }

  switch (request.level) {
    case "metadata":
      return { level: "metadata", id: document.id, metadata: document.metadata };
    case "summary":
      return {
        level: "summary",
        id: document.id,
        metadata: document.metadata,
        summary: document.summary,
        sections: document.sections.map(({ id, title, summary }) => ({
          id,
          title,
          summary,
        })),
      };
    case "section": {
      const section = document.sections.find(
        (candidate) => candidate.id === request.sectionId,
      );
      if (!section) {
        throw new RetrievalError(
          `Unknown section ${request.sectionId} in ${document.id}`,
        );
      }
      return {
        level: "section",
        id: document.id,
        metadata: document.metadata,
        summary: document.summary,
        section,
      };
    }
    case "full":
      return { level: "full", document };
  }
}

export interface RetrievedEvent {
  readonly id: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly occurredAt: string;
  readonly sequence: number;
  readonly summary: string;
  readonly relatedRefs: readonly string[];
  readonly scopeIds: readonly string[];
  readonly causedByEventIds: readonly string[];
  readonly origin?: CanonicalEvent["origin"];
  readonly payload: CanonicalEvent["payload"];
  readonly access: CanonicalEvent["access"];
  readonly sourceComponent: CanonicalEvent["sourceComponent"];
}

export interface EventRetrievalRequest {
  readonly role: ModelRole;
  readonly perspective: Perspective;
  readonly query: EventQuery;
  readonly localReferences?: Readonly<Record<string, string>>;
}

export async function retrieveEventHistory(
  history: Pick<EventHistoryStore, "query">,
  worldId: WorldId,
  request: EventRetrievalRequest,
): Promise<readonly RetrievedEvent[]> {
  const privileged = request.role === "orchestrator" ||
    request.role === "planner" || request.role === "debug";
  const requestedAccess = request.query.access ?? (privileged
    ? ["public", "gm-only"] as const
    : ["public"] as const);
  const access = privileged
    ? requestedAccess
    : requestedAccess.filter((value) => value === "public");
  if (access.length === 0) return [];
  const boundedQuery: EventQuery = {
    ...request.query,
    access: [...access],
    limit: Math.min(request.query.limit ?? 25, 100),
  };
  const events = await history.query(worldId, boundedQuery);
  const refByCanonical = new Map(
    Object.entries(request.localReferences ?? {}).map(([ref, canonical]) => [
      canonical,
      ref,
    ]),
  );
  return events.map((event) => ({
    id: event.id,
    type: event.type,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    sequence: event.sequence,
    summary: event.summary,
    relatedRefs: event.relatedEntityIds.flatMap((id) => {
      const ref = refByCanonical.get(id);
      return ref ? [ref] : [];
    }),
    scopeIds: [...event.scopeIds],
    causedByEventIds: [...event.causedByEventIds],
    ...(event.origin ? { origin: { ...event.origin } } : {}),
    payload: JSON.parse(JSON.stringify(event.payload)) as CanonicalEvent["payload"],
    access: event.access,
    sourceComponent: { ...event.sourceComponent },
  }));
}
