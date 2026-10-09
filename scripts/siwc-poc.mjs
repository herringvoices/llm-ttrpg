import { spawn } from "node:child_process";
import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from "node:crypto";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { z } from "zod";

export const SIWC_ISSUER = "https://auth.openai.com";
export const BOOTSTRAP_CLIENT_ID = "dynamic_agent_client";
export const REQUESTED_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
];
const APP_NAME = "llm-ttrpg";
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const REQUIRED_INFERENCE_SCOPES = ["openid", "resource.invoke", "chatgpt.tokens.use.direct"];
const appConfigDirectory = join(
  process.env.APPDATA ?? join(homedir(), ".config"),
  "llm-ttrpg-siwc-poc",
);
const hostIdFile = join(appConfigDirectory, "host-id");

const operationSelectionSchema = z.object({
  toolId: z.string().min(1),
  arguments: z.record(z.unknown()),
}).strict();

export const operationSelectionJsonSchema = {
  type: "object",
  properties: {
    toolId: { type: "string" },
    arguments: {
      type: "object",
      properties: { subjectId: { type: "string" } },
      required: ["subjectId"],
      additionalProperties: false,
    },
  },
  required: ["toolId", "arguments"],
  additionalProperties: false,
};

export function validateOperationSelection(value) {
  return operationSelectionSchema.safeParse(value);
}

export class SiwcError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "SiwcError";
    this.status = status;
    this.code = code;
  }
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createAuthorizationUrl({
  endpoint,
  redirectUri,
  state,
  nonce,
  challenge,
  hostId,
  clientId = BOOTSTRAP_CLIENT_ID,
}) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.hostname !== "auth.openai.com") {
    throw new SiwcError("OIDC discovery returned an untrusted authorization endpoint.");
  }
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: REQUESTED_SCOPES.join(" "),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    agent_name_hint: APP_NAME,
    ext_agent_host_id: hostId,
  }).toString();
  return url;
}

export function hasRequiredInferenceScopes(scopeValue) {
  if (typeof scopeValue !== "string") return false;
  const granted = new Set(scopeValue.split(/\s+/).filter(Boolean));
  return REQUIRED_INFERENCE_SCOPES.every((scope) => granted.has(scope));
}

export function classifySiwcError({ status, code } = {}) {
  if (code === "subscription_sharing_usage_limit_exceeded") {
    return "Usage limit reached; manage usage in ChatGPT Settings → Usage or retry manually later.";
  }
  if (code === "subscription_sharing_usage_unavailable") {
    return "ChatGPT usage availability cannot currently be checked; retry later.";
  }
  if (code === "subscription_sharing_user_not_eligible") {
    return "This ChatGPT account or workspace is not eligible for this inference permission.";
  }
  if (status === 401) return "Authorization was rejected or has expired; sign in again.";
  return "The request failed. Check the status and error code below; no automatic retry was attempted.";
}

function decodeJwtPart(part) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new SiwcError("OpenID returned a malformed ID token.");
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateIdToken(token, {
  issuer = SIWC_ISSUER,
  audiences,
  nonce,
  jwks,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (typeof token !== "string") throw new SiwcError("OpenID did not return an ID token.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new SiwcError("OpenID returned a malformed ID token.");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const claims = decodeJwtPart(encodedClaims);
  if (!["RS256", "ES256"].includes(header.alg) || typeof header.kid !== "string") {
    throw new SiwcError("The ID token uses an unsupported signing key.");
  }
  const key = jwks?.keys?.find((item) =>
    item.kid === header.kid &&
    (!item.alg || item.alg === header.alg) &&
    (!item.use || item.use === "sig"),
  );
  if (!key) throw new SiwcError("The ID token signing key was not found.");
  let validSignature = false;
  try {
    const publicKey = createPublicKey({ key, format: "jwk" });
    const signatureOptions = header.alg === "ES256"
      ? { key: publicKey, dsaEncoding: "ieee-p1363" }
      : publicKey;
    validSignature = verify(
      header.alg === "RS256" ? "RSA-SHA256" : "sha256",
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      signatureOptions,
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch {
    throw new SiwcError("The ID token signature could not be verified.");
  }
  if (!validSignature) throw new SiwcError("The ID token signature is invalid.");
  if (claims.iss !== issuer) throw new SiwcError("The ID token issuer is invalid.");
  const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.some((audience) => tokenAudiences.includes(audience))) {
    throw new SiwcError("The ID token audience is invalid.");
  }
  if (tokenAudiences.length > 1 && !audiences.includes(claims.azp)) {
    throw new SiwcError("The ID token authorized party is invalid.");
  }
  if (!safeEqual(claims.nonce, nonce)) throw new SiwcError("The ID token nonce is invalid.");
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds) {
    throw new SiwcError("The ID token has expired.");
  }
  if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > nowSeconds)) {
    throw new SiwcError("The ID token is not yet valid.");
  }
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new SiwcError("The ID token subject is missing.");
  }
  return claims;
}

function errorCode(body) {
  return typeof body?.error === "string"
    ? body.error
    : typeof body?.error?.code === "string"
      ? body.error.code
      : typeof body?.code === "string"
        ? body.code
        : undefined;
}

async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(30_000) });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new SiwcError("Network request failed; no credential or response body was logged.");
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    throw new SiwcError("The remote request was rejected.", {
      status: response.status,
      code: errorCode(body),
    });
  }
  if (!body || typeof body !== "object") throw new SiwcError("The server returned invalid JSON.");
  return body;
}

async function discoverOpenId() {
  const metadata = await fetchJson(
    `${SIWC_ISSUER}/.well-known/openid-configuration`,
    { method: "GET", signal: AbortSignal.timeout(30_000) },
  );
  if (metadata.issuer !== SIWC_ISSUER) {
    throw new SiwcError("OpenID discovery returned an unexpected issuer.");
  }
  for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    const endpoint = new URL(metadata[field]);
    if (endpoint.protocol !== "https:" || endpoint.hostname !== "auth.openai.com") {
      throw new SiwcError("OpenID discovery returned an untrusted endpoint.");
    }
  }
  return metadata;
}

async function getHostId() {
  try {
    const value = (await readFile(hostIdFile, "utf8")).trim();
    if (/^[0-9a-f-]{36}$/i.test(value)) return value;
  } catch {
    // Generate a new installation identifier when no valid identifier is available.
  }
  await mkdir(dirname(hostIdFile), { recursive: true, mode: 0o700 });
  const value = randomUUID();
  await writeFile(hostIdFile, `${value}\n`, { mode: 0o600 });
  return value;
}

function openSystemBrowser(url) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    const onError = () => reject(new SiwcError("Unable to launch the system browser."));
    child.once("error", onError);
    child.once("spawn", () => {
      child.off("error", onError);
      child.unref();
      resolve();
    });
  });
}

export function createCallbackServer(state) {
  let resolveCallback;
  let rejectCallback;
  let finished = false;
  const callback = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  let server;
  const finish = (error, result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    server.close();
    if (error) rejectCallback(error);
    else resolveCallback(result);
  };
  server = createServer((request, response) => {
    const remote = request.socket.remoteAddress;
    if (remote !== "127.0.0.1" && remote !== "::ffff:127.0.0.1") {
      response.writeHead(403).end("Loopback only.");
      return;
    }
    const address = server.address();
    if (!address || typeof address === "string") {
      response.writeHead(503).end("Callback listener is not ready.");
      return;
    }
    const callbackUri = `http://127.0.0.1:${address.port}/callback`;
    const callbackUrl = new URL(request.url ?? "/", callbackUri);
    if (request.method !== "GET" || callbackUrl.pathname !== "/callback") {
      response.writeHead(404).end("Not found.");
      return;
    }
    const returnedState = callbackUrl.searchParams.get("state");
    if (!returnedState || !safeEqual(returnedState, state)) {
      response.writeHead(400).end("Authorization state did not match; return to the terminal.");
      finish(new SiwcError("OAuth state validation failed."));
      return;
    }
    const responseIssuer = callbackUrl.searchParams.get("iss");
    if (responseIssuer && responseIssuer !== SIWC_ISSUER) {
      response.writeHead(400).end("Authorization issuer did not match.");
      finish(new SiwcError("OAuth authorization-response issuer was invalid."));
      return;
    }
    const oauthError = callbackUrl.searchParams.get("error");
    if (oauthError) {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end("ChatGPT authorization was not completed. Return to the terminal for details.");
      finish(new SiwcError("Authorization was declined or failed.", { code: oauthError }));
      return;
    }
    const code = callbackUrl.searchParams.get("code");
    if (!code) {
      response.writeHead(400).end("Authorization code was missing.");
      finish(new SiwcError("OAuth callback did not include an authorization code."));
      return;
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
      .end("ChatGPT authorization received. You may close this browser tab.");
    finish(undefined, { code, redirectUri: callbackUri });
  });
  const timer = setTimeout(() => finish(new SiwcError("Browser authorization timed out.")), CALLBACK_TIMEOUT_MS);
  timer.unref();
  const ready = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    callback,
    ready,
    close: () => {
      if (server.listening) server.close();
    },
    get redirectUri() {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new SiwcError("Unable to determine the loopback callback address.");
      }
      return `http://127.0.0.1:${address.port}/callback`;
    },
  };
}

function startAuthorization(metadata, hostId, nonce) {
  const pkce = createPkcePair();
  const state = randomBytes(32).toString("base64url");
  const loopback = createCallbackServer(state);
  const callback = (async () => {
    await loopback.ready;
    const authUrl = createAuthorizationUrl({
      endpoint: metadata.authorization_endpoint,
      redirectUri: loopback.redirectUri,
      state,
      nonce,
      challenge: pkce.challenge,
      hostId,
    });
    console.log("\nOpening the system browser for Sign in with ChatGPT.");
    await openSystemBrowser(authUrl.href);
    return loopback.callback;
  })();
  return {
    callback,
    close: loopback.close,
    verifier: pkce.verifier,
  };
}

async function exchangeCode(metadata, auth) {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: BOOTSTRAP_CLIENT_ID,
    code: auth.code,
    redirect_uri: auth.redirectUri,
    code_verifier: auth.verifier,
  });
  return fetchJson(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
}

function validateScopes(token) {
  if (!hasRequiredInferenceScopes(token.scope)) {
    throw new SiwcError(
      "Inference was not enabled: the authorization response did not explicitly grant both required usage scopes.",
      { code: "missing_inference_scopes" },
    );
  }
}

export function createTextRequest(model) {
  return {
    model,
    instructions: "Respond in one concise sentence. This is an isolated integration smoke test.",
    input: [{ role: "user", content: "Name one ordinary object found in a kitchen." }],
    store: false,
    stream: true,
  };
}

export function createStructuredRequest(model) {
  return {
    model,
    instructions: "Return one operation-selection object for the supplied operation. Do not claim that the operation was executed.",
    input: [{
      role: "user",
      content: 'Select toolId "knowledge.facts.retrieve" with arguments {"subjectId":"scene.001"}.',
    }],
    text: {
      format: {
        type: "json_schema",
        name: "operation_selection",
        strict: true,
        schema: operationSelectionJsonSchema,
      },
    },
    store: false,
    stream: true,
  };
}

export async function readResponsesStream(response) {
  if (!response.body) throw new SiwcError("The Responses API returned no stream body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let terminalResponse;
  let terminalEvent = false;

  const consume = (block) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new SiwcError("The Responses API stream contained malformed event data.");
    }
    const type = event.type;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      text += event.delta;
    } else if (type === "response.completed") {
      terminalEvent = true;
      terminalResponse = event.response;
    } else if (type === "response.failed" || type === "response.incomplete" || type === "error") {
      throw new SiwcError("The Responses API stream ended with a non-success event.", {
        status: event.response?.status_code,
        code: event.error?.code ?? type,
      });
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) consume(block);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!terminalEvent || terminalResponse?.status !== "completed") {
    throw new SiwcError("The Responses API stream did not complete successfully.");
  }
  if (!text && typeof terminalResponse.output_text === "string") text = terminalResponse.output_text;
  if (!text && Array.isArray(terminalResponse.output)) {
    text = terminalResponse.output.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("");
  }
  if (!text) throw new SiwcError("The completed response contained no text output.");
  return {
    text,
    model: terminalResponse.model,
    usage: terminalResponse.usage,
  };
}

async function generate(accessToken, body) {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("authorization", ["Bearer", accessToken].join(" "));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  }).catch(() => {
    throw new SiwcError("The Responses API request failed at the network layer.");
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => undefined);
    throw new SiwcError("The Responses API rejected the inference request.", {
      status: response.status,
      code: errorCode(errorBody),
    });
  }
  return readResponsesStream(response);
}

async function listModels(accessToken) {
  const headers = new Headers();
  headers.set("authorization", ["Bearer", accessToken].join(" "));
  const result = await fetchJson("https://api.openai.com/v1/models", {
    method: "GET",
    headers,
  });
  if (!Array.isArray(result.data)) {
    throw new SiwcError("The models endpoint did not return a model catalog.");
  }
  return result.data
    .map((model) => model?.id)
    .filter((id) => typeof id === "string")
    .sort();
}

async function chooseModel(models) {
  if (models.length === 0) throw new SiwcError("No models were returned for this account.");
  console.log("\nModels returned by the signed-in account:");
  models.forEach((model, index) => console.log(`  ${index + 1}. ${terminalText(model, 120)}`));
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question("\nChoose a model number: ");
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= models.length) {
      throw new SiwcError("The selected model number is not in the returned catalog.");
    }
    return models[index];
  } finally {
    prompt.close();
  }
}

function printUsage(usage) {
  if (Number.isInteger(usage?.input_tokens) || Number.isInteger(usage?.output_tokens)) {
    console.log(
      `Reported tokens: input ${usage.input_tokens ?? "not reported"}, output ${usage.output_tokens ?? "not reported"} (diagnostics only; not account balance or price).`,
    );
  } else {
    console.log("Token usage was not reported by this response.");
  }
}

function terminalText(value, maxLength = 1_000) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, maxLength);
}

function reportError(error) {
  const status = error?.status;
  const code = typeof error?.code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(error.code)
    ? error.code
    : undefined;
  console.error(`\n${classifySiwcError({ status, code })}`);
  if (status) console.error(`HTTP status: ${status}`);
  if (code) console.error(`Provider error code: ${code}`);
  console.error("No token, authorization code, prompt, response body, or session data was written to logs.");
}

export async function runPoc() {
  console.log("Development-only Sign in with ChatGPT proof of concept.");
  console.log("The access and refresh tokens are held in memory for this run and are never saved.");
  const metadata = await discoverOpenId();
  const hostId = await getHostId();
  const nonce = randomBytes(32).toString("base64url");
  const authorization = startAuthorization(metadata, hostId, nonce);
  let callback;
  try {
    callback = await authorization.callback;
  } finally {
    authorization.close();
  }
  const token = await exchangeCode(metadata, {
    ...callback,
    verifier: authorization.verifier,
  });
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new SiwcError("The token response did not include an access token.");
  }
  validateScopes(token);
  const issuedClientId = token.client_id ?? token.issued_client_id;
  if (issuedClientId && issuedClientId === BOOTSTRAP_CLIENT_ID) {
    throw new SiwcError("The bootstrap client ID was not replaced by an issued client ID.");
  }
  const jwks = await fetchJson(metadata.jwks_uri, { method: "GET" });
  validateIdToken(token.id_token, {
    issuer: metadata.issuer,
    audiences: [...new Set([BOOTSTRAP_CLIENT_ID, issuedClientId].filter(Boolean))],
    nonce,
    jwks,
  });
  console.log("\nOpenID signature and required identity claims verified (subject not shown or saved).");
  if (issuedClientId) console.log("An issued client ID was returned (not saved by this proof of concept).");
  else console.log("No issued client ID was exposed in the token response; record this as a registration limitation.");
  const models = await listModels(token.access_token);
  console.log(`\nModel catalog returned ${models.length} model(s).`);
  const model = await chooseModel(models);

  console.log("\nRunning the text-generation request (Responses API, stream required, store disabled)...");
  const textStartedAt = Date.now();
  const textResult = await generate(token.access_token, createTextRequest(model));
  console.log(`Completed in ${((Date.now() - textStartedAt) / 1_000).toFixed(1)}s.`);
  console.log(`Text response${textResult.model ? ` (${terminalText(textResult.model, 120)})` : ""}: ${terminalText(textResult.text)}`);
  printUsage(textResult.usage);

  console.log("\nRunning constrained operation-selection JSON Schema request...");
  const structuredStartedAt = Date.now();
  const structuredResult = await generate(token.access_token, createStructuredRequest(model));
  console.log(`Completed in ${((Date.now() - structuredStartedAt) / 1_000).toFixed(1)}s.`);
  const parsed = JSON.parse(structuredResult.text);
  const validated = validateOperationSelection(parsed);
  if (!validated.success) {
    throw new SiwcError("The structured response failed the existing operation-selection Zod shape.");
  }
  console.log("Zod validation passed for the operation-selection result.");
  printUsage(structuredResult.usage);
  console.log("\nPOC completed. No game state or campaign data was read or changed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPoc().catch((error) => {
    reportError(error);
    process.exitCode = 1;
  });
}
