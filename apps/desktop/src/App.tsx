import { useEffect, useState } from "react";
import type { WorldMetadata } from "@llm-ttrpg/engine";
import type { DesktopApplication } from "./application.js";

export function App({ application }: { readonly application: DesktopApplication }) {
  const [worlds, setWorlds] = useState<readonly WorldMetadata[]>([]);
  const [name, setName] = useState("New campaign");
  const [message, setMessage] = useState("Loading worlds…");

  async function refresh() {
    const loaded = await application.listWorlds();
    setWorlds(loaded);
    setMessage(loaded.length === 0 ? "No worlds yet." : `${loaded.length} world(s)`);
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Unable to load worlds");
    });
  }, []);

  async function createWorld() {
    const session = await application.createWorld(name.trim() || "Untitled campaign");
    await session.save("Manual save");
    await refresh();
    setMessage(`Created and checkpointed ${session.worldId}`);
  }

  return (
    <main>
      <h1>LLM TTRPG</h1>
      <p>{message}</p>
      <section aria-labelledby="new-world-heading">
        <h2 id="new-world-heading">Create a world</h2>
        <input aria-label="World name" value={name} onChange={(event) => setName(event.target.value)} />
        <button type="button" onClick={() => void createWorld()}>Create</button>
      </section>
      <section aria-labelledby="worlds-heading">
        <h2 id="worlds-heading">Worlds</h2>
        <ul>{worlds.map((world) => <li key={world.id}>{world.name}</li>)}</ul>
      </section>
    </main>
  );
}
