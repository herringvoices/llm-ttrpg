import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { startDesktopApplication } from "./application.js";
import { LlamaCppModelRuntime } from "./model/llama-cpp-model-runtime.js";
import { OllamaModelRuntime } from "./model/ollama-model-runtime.js";
import "./styles.css";

interface LocalModelConnection {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
}

interface LocalModelProgress {
  readonly phase: "downloading" | "verifying" | "starting" | "ready";
  readonly message: string;
  readonly downloadedBytes: number;
  readonly totalBytes: number;
}

const root = createRoot(document.getElementById("root")!);

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function renderSetup(progress: LocalModelProgress): void {
  const ratio = progress.totalBytes > 0
    ? Math.min(1, progress.downloadedBytes / progress.totalBytes)
    : 0;
  root.render(
    <main className="model-setup" aria-live="polite">
      <p className="eyebrow">One-time local AI setup</p>
      <h1>Preparing your game master</h1>
      <p>{progress.message}</p>
      {progress.phase === "downloading" && (
        <>
          <progress value={progress.downloadedBytes} max={progress.totalBytes} />
          <small>{formatBytes(progress.downloadedBytes)} of {formatBytes(progress.totalBytes)} · interrupted downloads resume automatically</small>
        </>
      )}
      <p className="setup-note">The model runs only on this computer. The first setup needs an internet connection and roughly 5.1 GB of free disk space.</p>
    </main>,
  );
}

async function bundledRuntime(): Promise<LlamaCppModelRuntime> {
  let unlisten: UnlistenFn | undefined;
  try {
    unlisten = await listen<LocalModelProgress>("local-model-progress", ({ payload }) => {
      renderSetup(payload);
    });
    renderSetup({
      phase: "starting",
      message: "Checking the bundled local model...",
      downloadedBytes: 0,
      totalBytes: 5_027_783_488,
    });
    const connection = await invoke<LocalModelConnection>("ensure_local_model");
    return new LlamaCppModelRuntime({
      baseUrl: connection.endpoint,
      apiKey: connection.apiKey,
      model: connection.model,
      contextWindowTokens: 16_384,
    });
  } finally {
    unlisten?.();
  }
}

async function bootstrap(): Promise<void> {
  const modelRuntime = isTauri()
    ? await bundledRuntime()
    : new OllamaModelRuntime({
        baseUrl: import.meta.env.VITE_OLLAMA_BASE_URL ?? "http://localhost:11434",
        model: import.meta.env.VITE_OLLAMA_MODEL ?? "qwen3:8b",
      });
  const application = await startDesktopApplication({ modelRuntime });
  root.render(<StrictMode><App application={application} /></StrictMode>);
}

function renderFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  root.render(
    <main className="model-setup">
      <p className="eyebrow">Setup needs attention</p>
      <h1>Unable to start the local model</h1>
      <p className="error">{message}</p>
      <button type="button" onClick={() => void bootstrap().catch(renderFailure)}>Try again</button>
      <p className="setup-note">Check your internet connection and available disk space. A partial model download will continue instead of restarting.</p>
    </main>,
  );
}

void bootstrap().catch(renderFailure);
