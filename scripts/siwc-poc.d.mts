export const SIWC_ISSUER: string;
export const SIWC_RESOURCE: string;
export const BOOTSTRAP_CLIENT_ID: string;
export const REQUESTED_SCOPES: readonly string[];
export const operationSelectionJsonSchema: Record<string, unknown>;

export class SiwcError extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(message: string, options?: { status?: number; code?: string });
}

export function createPkcePair(): { verifier: string; challenge: string };
export function createAuthorizationUrl(options: {
  endpoint: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
  hostId: string;
  clientId?: string;
}): URL;
export function hasRequiredInferenceScopes(scopeValue?: unknown): boolean;
export function classifySiwcError(options?: { status?: number; code?: string }): string;
export function validateOperationSelection(value: unknown):
  | { success: true; data: { toolId: string; arguments: Record<string, unknown> } }
  | { success: false; error: Error };
export function createTextRequest(model: string): Record<string, unknown>;
export function createStructuredRequest(model: string): Record<string, unknown>;
export function createCallbackServer(state: string): {
  server: import("node:http").Server;
  callback: Promise<{ code: string; redirectUri: string }>;
  ready: Promise<unknown>;
  close(): void;
  readonly redirectUri: string;
};
export function readResponsesStream(response: Response): Promise<{
  text: string;
  model?: string;
  usage?: Record<string, unknown>;
}>;
export function validateIdToken(
  token: string,
  options: {
    issuer?: string;
    audiences: readonly string[];
    nonce: string;
    jwks: { keys: readonly Record<string, unknown>[] };
    nowSeconds?: number;
  },
): Record<string, unknown> & { sub: string };
export function runPoc(): Promise<void>;
