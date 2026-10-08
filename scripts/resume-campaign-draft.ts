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

const databasePath = process.env.REPLAY_DATABASE_PATH;
const endpoint = process.env.REPLAY_ENDPOINT;
const apiKey = process.env.REPLAY_API_KEY;
const tracePath = process.env.REPLAY_TRACE_PATH;
const draftId = process.env.REPLAY_DRAFT_ID;

if (!databasePath || !endpoint || !apiKey || !tracePath || !draftId) {
  throw new Error(
    "REPLAY_DATABASE_PATH, REPLAY_ENDPOINT, REPLAY_API_KEY, REPLAY_TRACE_PATH, and REPLAY_DRAFT_ID are required",
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
  async select<T>(query, bindValues: readonly SqlBindValue[] = []): Promise<T> {
    const normalized = positionalQuery(query, bindValues);
    return database.prepare(normalized.query).all(...normalized.bindValues) as T;
  },
};

const invocations: unknown[] = [];
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
    invocations.push({
      operation: request.trace?.operation,
      invocationId: request.trace?.invocationId,
      outputKind: request.output.kind,
      schemaId: request.output.kind === "structured" ? request.output.schemaId : undefined,
      prompt: request.prompt,
      options,
      elapsedMs: Date.now() - startedAt,
      result,
    });
    console.log(JSON.stringify({
      kind: "model-invocation",
      invocationId: request.trace?.invocationId,
      schemaId: request.output.kind === "structured" ? request.output.schemaId : undefined,
      ok: result.ok,
      elapsedMs: Date.now() - startedAt,
      error: result.ok ? undefined : result.error,
    }));
    return result;
  },
};

const application = createDesktopApplication(sqlClient, { modelRuntime: tracedRuntime });
let outcome: unknown;
let failure: unknown;
try {
  const result = await application.resumeCampaign(draftId, {
    onProgress(progress) {
      console.log(JSON.stringify({ kind: "progress", ...progress }));
    },
  });
  outcome = result.kind === "created"
    ? { kind: result.kind, view: result.session.view() }
    : result;
} catch (error) {
  failure = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : String(error);
}

const drafts = database.prepare(
  "SELECT id, name, status, last_completed_stage_id, error_message, updated_at FROM campaign_generation_drafts ORDER BY updated_at DESC",
).all();
const worlds = database.prepare(
  "SELECT id, name, revision, event_sequence, updated_at FROM worlds ORDER BY updated_at DESC",
).all();
await writeFile(tracePath, JSON.stringify({
  capturedAt: new Date().toISOString(),
  draftId,
  invocations,
  outcome,
  failure,
  drafts,
  worlds,
}, null, 2), "utf8");
database.close();

if (failure) {
  throw new Error(`Campaign resume failed: ${(failure as { message?: string }).message ?? String(failure)}`);
}
console.log(JSON.stringify({ kind: "complete", outcome, tracePath }, null, 2));
