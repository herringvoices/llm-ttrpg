import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_CLIENT_ID,
  REQUESTED_SCOPES,
  SIWC_ISSUER,
  SIWC_RESOURCE,
  classifySiwcError,
  createAuthorizationUrl,
  createCallbackServer,
  createPkcePair,
  createStructuredRequest,
  createTextRequest,
  hasRequiredInferenceScopes,
  operationSelectionJsonSchema,
  readResponsesStream,
  validateIdToken,
  validateOperationSelection,
} from "../scripts/siwc-poc.mjs";

function signedIdToken({
  privateKey,
  kid,
  issuer = SIWC_ISSUER,
  audience = BOOTSTRAP_CLIENT_ID,
  nonce = "test-nonce",
  exp = 2_000,
}: {
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  kid: string;
  issuer?: string;
  audience?: string;
  nonce?: string;
  exp?: number;
}) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid, typ: "JWT" });
  const claims = encode({ iss: issuer, aud: audience, nonce, exp, sub: "local-test-subject" });
  const input = `${header}.${claims}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

describe("Sign in with ChatGPT development proof of concept", () => {
  it("creates a PKCE S256 verifier/challenge pair", () => {
    const pair = createPkcePair();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.challenge).toBe(
      createHash("sha256").update(pair.verifier).digest("base64url"),
    );
  });

  it("builds browser authorization with loopback redirect, OIDC, usage scopes, state and PKCE", () => {
    const url = createAuthorizationUrl({
      endpoint: `${SIWC_ISSUER}/oauth/authorize`,
      redirectUri: "http://127.0.0.1:43127/callback",
      state: "state-value",
      nonce: "nonce-value",
      challenge: "challenge-value",
      hostId: "stable-host-id",
    });
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43127/callback");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("nonce")).toBe("nonce-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("resource")).toBe(SIWC_RESOURCE);
    expect(url.searchParams.get("agent_name_hint")).toBe("llm-ttrpg");
    expect(url.searchParams.get("ext_agent_host_id")).toBe("stable-host-id");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(REQUESTED_SCOPES);
    expect(() => createAuthorizationUrl({
      endpoint: "https://malicious.example/authorize",
      redirectUri: "http://127.0.0.1/callback",
      state: "s",
      nonce: "n",
      challenge: "c",
      hostId: "h",
    })).toThrow(/untrusted/);
  });

  it("accepts one loopback callback only when OAuth state matches", async () => {
    const callback = createCallbackServer("expected-state");
    await callback.ready;
    const redirectUri = callback.redirectUri;
    try {
      const result = await fetch(
        `${redirectUri}?code=one-time-code&state=expected-state`,
      );
      expect(result.status).toBe(200);
      await expect(callback.callback).resolves.toMatchObject({
        code: "one-time-code",
        redirectUri,
      });
      expect(callback.server.listening).toBe(false);
    } finally {
      callback.close();
    }
  });

  it("rejects a loopback callback with mismatched OAuth state", async () => {
    const callback = createCallbackServer("expected-state");
    await callback.ready;
    try {
      const callbackResult = callback.callback.catch((error: unknown) => error);
      const response = await fetch(
        `${callback.redirectUri}?code=never-accepted&state=wrong-state`,
      );
      expect(response.status).toBe(400);
      await expect(callbackResult).resolves.toMatchObject({
        message: "OAuth state validation failed.",
      });
    } finally {
      callback.close();
    }
  });

  it("requires explicit inference scopes and reports usage, availability, and eligibility distinctly", () => {
    expect(hasRequiredInferenceScopes("openid resource.invoke chatgpt.tokens.use.direct")).toBe(true);
    expect(hasRequiredInferenceScopes("openid resource.invoke")).toBe(false);
    expect(hasRequiredInferenceScopes(undefined)).toBe(false);
    expect(classifySiwcError({
      status: 429,
      code: "subscription_sharing_usage_limit_exceeded",
    })).toMatch(/manage usage/i);
    expect(classifySiwcError({ status: 429, code: "rate_limit_exceeded" }))
      .not.toMatch(/Usage limit reached/);
    expect(classifySiwcError({
      status: 503,
      code: "subscription_sharing_usage_unavailable",
    })).toMatch(/cannot currently be checked/);
    expect(classifySiwcError({ status: 503, code: "server_error" }))
      .not.toMatch(/usage availability/);
    expect(classifySiwcError({
      status: 403,
      code: "subscription_sharing_user_not_eligible",
    })).toMatch(/not eligible/);
  });

  it("validates a signed ID token's signature and required OIDC claims", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = {
      ...publicKey.export({ format: "jwk" }),
      kid: "test-key",
      alg: "RS256",
      use: "sig",
    };
    const token = signedIdToken({ privateKey, kid: "test-key", exp: 2_000 });
    expect(validateIdToken(token, {
      audiences: [BOOTSTRAP_CLIENT_ID],
      nonce: "test-nonce",
      jwks: { keys: [jwk] },
      nowSeconds: 1_000,
    }).sub).toBe("local-test-subject");
    expect(() => validateIdToken(token, {
      audiences: [BOOTSTRAP_CLIENT_ID],
      nonce: "wrong-nonce",
      jwks: { keys: [jwk] },
      nowSeconds: 1_000,
    })).toThrow(/nonce/);
    expect(() => validateIdToken(signedIdToken({
      privateKey,
      kid: "test-key",
      issuer: "https://attacker.example",
    }), {
      audiences: [BOOTSTRAP_CLIENT_ID],
      nonce: "test-nonce",
      jwks: { keys: [jwk] },
      nowSeconds: 1_000,
    })).toThrow(/issuer/);
    expect(() => validateIdToken(signedIdToken({
      privateKey,
      kid: "test-key",
      exp: 999,
    }), {
      audiences: [BOOTSTRAP_CLIENT_ID],
      nonce: "test-nonce",
      jwks: { keys: [jwk] },
      nowSeconds: 1_000,
    })).toThrow(/expired/);
  });

  it("requests strict operation-selection JSON and validates complete output with Zod", () => {
    expect(createTextRequest("account-visible-model")).toMatchObject({
      model: "account-visible-model",
      store: false,
      stream: true,
      input: [{ role: "user" }],
    });
    const request = createStructuredRequest("account-visible-model");
    expect(request).toMatchObject({ store: false, stream: true });
    expect(request.text).toEqual({
      format: {
        type: "json_schema",
        name: "operation_selection",
        strict: true,
        schema: operationSelectionJsonSchema,
      },
    });
    expect(validateOperationSelection({
      toolId: "knowledge.facts.retrieve",
      arguments: { subjectId: "scene.001" },
    })).toMatchObject({ success: true });
    expect(validateOperationSelection({ toolId: "", arguments: {} }).success).toBe(false);
  });

  it("accepts only complete Responses API streams", async () => {
    const stream = new Response([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ready"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","model":"test-model","usage":{"input_tokens":4,"output_tokens":2}}}\n\n',
    ].join(""));
    await expect(readResponsesStream(stream)).resolves.toEqual({
      text: "ready",
      model: "test-model",
      usage: { input_tokens: 4, output_tokens: 2 },
    });
    const interrupted = new Response(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n',
    );
    await expect(readResponsesStream(interrupted)).rejects.toThrow(/did not complete successfully/);
  });
});
