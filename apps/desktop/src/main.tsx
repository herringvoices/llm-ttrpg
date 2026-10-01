import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { startDesktopApplication } from "./application.js";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

void startDesktopApplication()
  .then((application) => {
    root.render(<StrictMode><App application={application} /></StrictMode>);
  })
  .catch((error: unknown) => {
    root.render(<main><h1>Unable to start</h1><pre>{String(error)}</pre></main>);
  });
