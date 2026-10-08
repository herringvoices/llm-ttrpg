import { writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type {
  ModelInvocationOptions,
  ModelRuntime,
  StructuredModelRequest,
  StructuredModelResult,
  TextModelRequest,
  TextModelResult,
} from "@llm-ttrpg/engine";
import { createDesktopApplication } from "../apps/desktop/src/application.js";
import { LlamaCppModelRuntime } from "../apps/desktop/src/model/llama-cpp-model-runtime.js";
import type {
  SqlBindValue,
  SqlClient,
} from "../apps/desktop/src/persistence/sql-client.js";

const worldId = process.env.REPLAY_WORLD_ID ?? "world.17901858-a597-4924-aaef-f7062460d6c0";
const declaration = process.env.REPLAY_DECLARATION ??
  "I'm heading to the showers first. There's a leaky pipe that should be a quick fix.";
const databasePath = process.env.REPLAY_DATABASE_PATH;
const endpoint = process.env.REPLAY_ENDPOINT;
const apiKey = process.env.REPLAY_API_KEY;
const tracePath = process.env.REPLAY_TRACE_PATH;
const resumeOpeningOnly = process.env.REPLAY_RESUME_OPENING === "1";

if (!databasePath || !endpoint || !apiKey || !tracePath) {
  throw new Error(
    "REPLAY_DATABASE_PATH, REPLAY_ENDPOINT, REPLAY_API_KEY, and REPLAY_TRACE_PATH are required",
  );
}

function positionalQuery(
  query: string,
  bindValues: readonly SqlBindValue[],
): { readonly query: string; readonly bindValues: readonly SqlBindValue[] } {
  const positional: SqlBindValue[] = [];
  const normalized = query.replace(/\$(\d+)/g, (_match, rawIndex: string) => {
    const index = Number(rawIndex) - 1;
    if (index < 0 || index >= bindValues.length) {
      throw new Error(`Missing SQL bind value $${rawIndex}`);
    }
    positional.push(bindValues[index]!);
    return "?";
  });
  return positional.length > 0
    ? { query: normalized, bindValues: positional }
    : { query, bindValues };
}

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA busy_timeout = 5000");

const sqlClient: SqlClient = {
  async execute(query, bindValues = []) {
    const normalized = positionalQuery(query, bindValues);
    return database.prepare(normalized.query).run(...normalized.bindValues);
  },
  async select<T>(query: string, bindValues: readonly SqlBindValue[] = []): Promise<T> {
    const normalized = positionalQuery(query, bindValues);
    return database.prepare(normalized.query).all(...normalized.bindValues) as T;
  },
};

interface CapturedInvocation {
  readonly index: number;
  readonly operation?: string;
  readonly invocationId?: string;
  readonly outputKind: "text" | "structured";
  readonly schemaId?: string;
  readonly prompt: unknown;
  readonly options?: unknown;
  readonly elapsedMs: number;
  readonly result: unknown;
}

const captured: CapturedInvocation[] = [];
const underlying = new LlamaCppModelRuntime({
  baseUrl: endpoint,
  apiKey,
  model: "llm-ttrpg-qwen3.5-9b",
  contextWindowTokens: 16_384,
});

const tracedRuntime: ModelRuntime = {
  capabilities: underlying.capabilities,
  async generate(
    request: TextModelRequest | StructuredModelRequest<unknown>,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult | StructuredModelResult<unknown>> {
    const startedAt = Date.now();
    const result = request.output.kind === "text"
      ? await underlying.generate(request, options)
      : await underlying.generate(request, options);
    const entry: CapturedInvocation = {
      index: captured.length + 1,
      ...(request.trace?.operation ? { operation: request.trace.operation } : {}),
      ...(request.trace?.invocationId ? { invocationId: request.trace.invocationId } : {}),
      outputKind: request.output.kind,
      ...(request.output.kind === "structured" ? { schemaId: request.output.schemaId } : {}),
      prompt: request.prompt,
      ...(options ? { options } : {}),
      elapsedMs: Date.now() - startedAt,
      result,
    };
    captured.push(entry);
    const resultSummary = result.ok
      ? request.output.kind === "structured"
        ? result.output.value
        : result.output.text
      : result.failure;
    console.log(JSON.stringify({
      kind: "model-invocation",
      index: entry.index,
      operation: entry.operation,
      outputKind: entry.outputKind,
      schemaId: entry.schemaId,
      elapsedMs: entry.elapsedMs,
      result: resultSummary,
    }));
    return result;
  },
};

const application = createDesktopApplication(sqlClient, { modelRuntime: tracedRuntime });
const session = await application.openWorld(worldId);
const before = session.view();
console.log(JSON.stringify({
  kind: "before",
  transcriptEntries: before.transcript.length,
  locationId: before.currentLocationId,
  openingProgression: before.openingProgression,
}));

const after = resumeOpeningOnly
  ? await session.retryNarration((view) => {
      console.log(JSON.stringify({
        kind: "progress",
        phase: view.turnProgress?.phase,
        transcriptEntries: view.transcript.length,
      }));
    })
  : await session.performTurn(declaration, (view) => {
  console.log(JSON.stringify({
    kind: "progress",
    phase: view.turnProgress?.phase,
    transcriptEntries: view.transcript.length,
  }));
  });

const actionRows = database.prepare(
  "SELECT action_id, declaration, run_json FROM action_runs WHERE world_id = ? ORDER BY rowid",
).all(worldId).map((row) => ({
  actionId: row.action_id,
  declaration: row.declaration,
  run: JSON.parse(String(row.run_json)),
}));
const events = database.prepare(
  "SELECT sequence, event_id, event_type, canonical_json FROM events WHERE world_id = ? ORDER BY sequence",
).all(worldId).map((row) => ({
  sequence: row.sequence,
  eventId: row.event_id,
  eventType: row.event_type,
  canonical: JSON.parse(String(row.canonical_json)),
}));
const locationFacts = database.prepare(
  "SELECT fact_id, subject_id, predicate, value_json FROM facts WHERE world_id = ? AND predicate = 'actor.current-location' ORDER BY rowid",
).all(worldId).map((row) => ({
  factId: row.fact_id,
  subjectId: row.subject_id,
  predicate: row.predicate,
  value: JSON.parse(String(row.value_json)),
}));

const report = {
  capturedAt: new Date().toISOString(),
  worldId,
  declaration,
  before,
  after,
  modelInvocations: captured,
  actionRows,
  events,
  locationFacts,
};
await writeFile(tracePath, JSON.stringify(report, null, 2), "utf8");

console.log(JSON.stringify({
  kind: "after",
  transcriptEntries: after.transcript.length,
  latestTranscript: after.transcript.slice(-2),
  locationId: after.currentLocationId,
  openingProgression: after.openingProgression,
  error: after.error,
  diagnostics: after.diagnostics,
  actionRows,
  newEvents: events.filter((event) => event.sequence > 1),
  locationFacts,
  tracePath,
}, null, 2));

database.close();
