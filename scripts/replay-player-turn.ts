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
const worldId = process.env.REPLAY_WORLD_ID;
const declaration = process.env.REPLAY_DECLARATION;

if (!databasePath || !endpoint || !apiKey || !tracePath || !worldId || !declaration) {
  throw new Error(
    "REPLAY_DATABASE_PATH, REPLAY_ENDPOINT, REPLAY_API_KEY, REPLAY_TRACE_PATH, REPLAY_WORLD_ID, and REPLAY_DECLARATION are required",
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
    const elapsedMs = Date.now() - startedAt;
    invocations.push({
      operation: request.trace?.operation,
      invocationId: request.trace?.invocationId,
      outputKind: request.output.kind,
      schemaId: request.output.kind === "structured" ? request.output.schemaId : undefined,
      prompt: request.prompt,
      options,
      elapsedMs,
      result,
    });
    console.log(JSON.stringify({
      kind: "model-invocation",
      operation: request.trace?.operation,
      schemaId: request.output.kind === "structured" ? request.output.schemaId : undefined,
      ok: result.ok,
      elapsedMs,
    }));
    return result;
  },
};

const application = createDesktopApplication(sqlClient, { modelRuntime: tracedRuntime });
let before: unknown;
let after: unknown;
let failure: unknown;
try {
  const session = await application.openWorld(worldId);
  before = session.view();
  after = await session.performTurn(declaration, (view) => {
    console.log(JSON.stringify({ kind: "progress", progress: view.turnProgress }));
  });
} catch (error) {
  failure = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : String(error);
}

await writeFile(tracePath, JSON.stringify({
  capturedAt: new Date().toISOString(),
  worldId,
  declaration,
  before,
  after,
  invocations,
  failure,
}, null, 2), "utf8");
database.close();

if (failure) {
  throw new Error(`Turn replay failed: ${(failure as { message?: string }).message ?? String(failure)}`);
}
console.log(JSON.stringify({ kind: "complete", after, tracePath }, null, 2));
