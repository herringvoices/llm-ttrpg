import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { startDesktopApplication } from "./application.js";
import { OllamaModelRuntime } from "./model/ollama-model-runtime.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

const modelRuntime = new OllamaModelRuntime({
  baseUrl: import.meta.env.VITE_OLLAMA_BASE_URL ?? "http://localhost:11434",
  model: import.meta.env.VITE_OLLAMA_MODEL ?? "qwen3:8b",
});

void startDesktopApplication({ modelRuntime })
  .then((application) => {
    root.render(<StrictMode><App application={application} /></StrictMode>);
  })
  .catch((error: unknown) => {
    root.render(<main><h1>Unable to start</h1><pre>{String(error)}</pre></main>);
  });
