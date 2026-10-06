# Local Model Runtime

Issue #15 defines the transport boundary between model-safe semantic input and a local inference provider. The model runtime is infrastructure. It does not own gameplay authorization, context retrieval, tool selection semantics, rules, or authoritative mutation.

## Provider-neutral contract

Callers provide a `ModelPrompt` containing:

- behavioral `instructions`
- optional opaque, already-authorized `context`
- optional semantic conversation turns using `user` / `model` speakers
- the current `input`

The core contract is deliberately not an OpenAI-style message array and contains no Ollama request fields. The provider adapter owns conversion to its native system/user/assistant representation. Trace metadata such as an operation or invocation ID is diagnostic only and never changes prompt behavior.

There are exactly two semantic output modes:

- `text` for narration or other free prose
- `structured` with a stable schema ID and authoritative Zod schema

For structured calls, the adapter derives JSON Schema for provider-side constrained generation, parses the complete returned JSON, validates it again with Zod, and returns the validated value only on success. Provider constraint support improves reliability but is not the authority boundary. Invalid or malformed output returns `invalid-output`; the adapter sends no hidden repair request.

Operation selection is ordinary structured data such as `{ toolId, arguments }`. Native provider tool-calling is not the engine abstraction. #9 remains the authoritative catalog/binding layer; the #11 pipeline decides when to resolve or execute one selection and permits one explicit corrective call after `invalid-output` without adding provider-side JSON repair.

## Results, failures, and capabilities

Successful results distinguish text from schema-validated structured values. Provider-neutral metadata may report runtime/model identifiers, elapsed duration, trace correlation, and input/output token counts when the provider actually supplies them.

Failures are normalized as:

- `cancelled`
- `timeout`
- `runtime-unavailable`
- `invalid-output`
- `capability`
- `context-too-large`

Raw Ollama response objects never cross the adapter. A bounded diagnostic string may be retained for developer logging. Runtime lifecycle observations use an optional transport observer and are never appended to canonical game event history.

Capabilities report structured-output support, text-streaming support, and a context-window size only when configured/known. A structured request fails with `capability` rather than silently degrading to prose when its runtime cannot honor the contract.

## Cancellation and streaming

The fundamental `generate` operation is non-streaming and supports a structural `AbortSignal` plus an optional provider-neutral timeout. The structural signal keeps `packages/engine` free of DOM dependencies. Cancellation and timeouts race the transport, so even a misbehaving custom transport cannot later return an actionable result.

Streaming is optional and text-only. It emits text deltas followed by provider-neutral completion metadata or one normalized failure. Partial structured JSON is never exposed as a semantic result.

## Development and bundled implementations

`apps/desktop/src/model/ollama-model-runtime.ts` contains all Ollama message, HTTP, response, and NDJSON-streaming types. `OllamaModelRuntime` accepts a base URL and model through application configuration. It maps semantic prompts internally, requests JSON-Schema-constrained structured generation, revalidates with Zod, supports native text streaming, and normalizes transport failures.

During browser development, Ollama remains an externally managed local service. Shipping Tauri builds instead use `LlamaCppModelRuntime`, an OpenAI-compatible adapter over a bundled, pinned llama.cpp CPU server. The Tauri host downloads the pinned Qwen3.5 9B Q4_K_M Standard model into application-local data on first launch, resumes partial downloads, verifies the model checksum, launches it on a dynamically selected authenticated localhost port, waits for readiness, and stops it on application exit. The Standard tier targets 64-bit Windows CPU inference on machines with approximately 16 GB system memory; it is not presented as a universal 8 GB configuration. Model installation/progress and process lifecycle are infrastructure concerns and never enter canonical game history.

The native host exposes tier metadata independently of save data: Standard is the installed default and Enhanced is a future player-controlled download tier. A tier selection changes inference quality only; it must never change game packages, canonical mechanics, or world/save schemas. Standard pins Unsloth's Qwen3.5 9B Q4_K_M GGUF conversion at revision `3885219b6810b007914f3a7950a8d1b469d598a5`; the 5,680,522,464-byte artifact is accepted only when its SHA-256 matches `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`. A previous Qwen3 8B installation is removed only after the Qwen3.5 file verifies successfully.

The 5.7 GB model is deliberately not embedded in the NSIS setup executable: NSIS has an approximately 2 GB single-installer ceiling. The setup executable includes the app and inference runtime, and the installed app completes the model installation automatically. No separately installed Ollama, Python, or model manager is required.

The desktop application accepts an optional provider-neutral `ModelRuntime` dependency. It does not import Ollama types, and the headless game runtime remains independent of model transport.

The bundled llama.cpp transport requests token streaming from the local HTTP server so long
CPU-bound generations continuously carry data and are not mistaken for dead connections by the
desktop webview. It buffers those chunks internally and exposes the same complete, non-streaming,
Zod-validated semantic result to the application.

## Context boundary

#10's deterministic serialized-character budget answers which authorized information is important enough to include. #15's provider token usage and optional context-window metadata answer whether a configured model can physically process that invocation. They remain separate. Provider token counts never feed back into context selection in this slice.

`renderContextForModel` can provide opaque safe context text. #15 does not parse scene, role, perspective, pressure, plan, rules, or world semantics out of that text.

## Verification

Automated tests mock the Ollama transport; they require no running service. They cover prompt mapping, JSON Schema generation, Zod validation, malformed/invalid output, no repair retry, cancellation, timeout, unavailable/context-overflow normalization, capabilities, observability, and text streaming.

For an optional live smoke test with Ollama already running:

```powershell
$env:OLLAMA_SMOKE = "1"
$env:OLLAMA_MODEL = "qwen3:4b" # choose an installed model
$env:OLLAMA_BASE_URL = "http://localhost:11434"
npm.cmd test -- --run tests/ollama-smoke.manual.test.ts
```

The smoke test accepts one Zod-validated intent-style result, then uses an intentionally rejecting Zod refinement to prove another provider result becomes `invalid-output` and cannot reach the guarded operation boundary. It does not execute a real operation or implement the player-action pipeline.
