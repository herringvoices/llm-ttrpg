import { useEffect, useRef, useState } from "react";
import type { WorldMetadata } from "@llm-ttrpg/engine";
import type { DesktopApplication } from "./application.js";
import type { DesktopPlaySession, PlaySessionView } from "./play-session.js";

export function App({ application }: { readonly application: DesktopApplication }) {
  const [worlds, setWorlds] = useState<readonly WorldMetadata[]>([]);
  const [name, setName] = useState("New Awakening Earth campaign");
  const [location, setLocation] = useState("A fictional small town in the upper Midwest");
  const [player, setPlayer] = useState("I am an ordinary local adult with close community ties and a practical job.");
  const [message, setMessage] = useState("Loading campaigns…");
  const [creating, setCreating] = useState(false);
  const [playSession, setPlaySession] = useState<DesktopPlaySession>();
  const [playView, setPlayView] = useState<PlaySessionView>();
  const [declaration, setDeclaration] = useState("");
  const transcriptEnd = useRef<HTMLDivElement>(null);

  async function refresh() {
    const loaded = await application.listWorlds();
    setWorlds(loaded);
    setMessage(loaded.length === 0 ? "No campaigns yet." : `${loaded.length} campaign(s)`);
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Unable to load campaigns");
    });
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [playView?.transcript.length]);

  async function createWorld() {
    setCreating(true);
    setMessage("Generating the region and realizing its opening situation…");
    try {
      const session = await application.createWorld({
        name,
        locationDescription: location,
        playerDescription: player,
      });
      setPlaySession(session);
      setPlayView(session.view());
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create campaign");
    } finally {
      setCreating(false);
    }
  }

  async function openWorld(worldId: string) {
    setMessage("Opening campaign…");
    try {
      const session = await application.openWorld(worldId);
      setPlaySession(session);
      setPlayView(session.view());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to open campaign");
    }
  }

  async function run(update: () => Promise<PlaySessionView>) {
    if (!playSession) return;
    const pending = update();
    setPlayView(playSession.view());
    setPlayView(await pending);
  }

  async function submitTurn() {
    const text = declaration.trim();
    if (!text || !playSession) return;
    setDeclaration("");
    await run(() => playSession.performTurn(text));
  }

  if (playSession && playView) {
    return (
      <main className="play-shell">
        <header className="play-header">
          <div>
            <p className="eyebrow">Awakening Earth</p>
            <h1>{playView.playerName}</h1>
            <p>{playView.currentLocationName ?? playView.currentLocationId ?? "Unknown location"} · {new Date(playView.fictionalTime).toLocaleString()}</p>
          </div>
          <div className="header-actions">
            <fieldset className="preference" disabled={playView.busy}>
              <legend>Narration</legend>
              {(["concise", "standard", "expansive"] as const).map((preference) => (
                <label key={preference}>
                  <input
                    type="radio"
                    name="narration-preference"
                    checked={playView.narrationPreference === preference}
                    onChange={() => setPlayView(playSession.setNarrationPreference(preference))}
                  />
                  {preference}
                </label>
              ))}
            </fieldset>
            <button disabled={playView.busy} onClick={() => void run(() => playSession.save())}>Save</button>
            <button disabled={playView.busy} onClick={() => { setPlaySession(undefined); setPlayView(undefined); void refresh(); }}>Return</button>
          </div>
        </header>

        <section className="transcript" aria-live="polite" aria-label="Game transcript">
          {playView.transcript.length === 0 && (
            <p className="empty-copy">The world is ready. Describe what you do or say.</p>
          )}
          {playView.transcript.map((entry) => (
            <article className={`transcript-entry ${entry.speaker}`} key={entry.id}>
              <span>{entry.speaker === "player" ? "You" : entry.speaker}</span>
              <p>{entry.text}</p>
            </article>
          ))}
          <div ref={transcriptEnd} />
        </section>

        {playView.error && <p className="error" role="alert">{playView.error}</p>}
        <section className="turn-composer">
          <textarea
            aria-label="What do you do?"
            placeholder="Describe what you do or say…"
            value={declaration}
            disabled={playView.busy}
            onChange={(event) => setDeclaration(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitTurn();
              }
            }}
          />
          <button disabled={playView.busy || !declaration.trim()} onClick={() => void submitTurn()}>
            {playView.busy ? "Resolving…" : "Continue"}
          </button>
        </section>

        <div className="secondary-actions">
          <button disabled={playView.busy} onClick={() => void run(() => playSession.passThreeDaysAndCatchUp())}>Pass three days and catch up</button>
          {playView.diagnostics?.narrationStatus === "failed" && (
            <button disabled={playView.busy} onClick={() => void run(() => playSession.retryNarration())}>Retry narration</button>
          )}
        </div>

        {import.meta.env.DEV && playView.diagnostics && (
          <details className="diagnostics">
            <summary>Development diagnostics</summary>
            <pre>{JSON.stringify(playView.diagnostics, null, 2)}</pre>
          </details>
        )}
      </main>
    );
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Local, persistent, text-first</p>
        <h1>LLM TTRPG</h1>
        <p>{message}</p>
      </header>
      <section aria-labelledby="new-world-heading">
        <h2 id="new-world-heading">Begin a campaign</h2>
        <label>Campaign name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Where does it begin?<textarea value={location} onChange={(event) => setLocation(event.target.value)} /></label>
        <label>Who are you?<textarea value={player} onChange={(event) => setPlayer(event.target.value)} /></label>
        <button type="button" disabled={creating} onClick={() => void createWorld()}>{creating ? "Generating…" : "Create campaign"}</button>
      </section>
      <section aria-labelledby="worlds-heading">
        <h2 id="worlds-heading">Continue</h2>
        {worlds.length === 0 ? <p>No saved campaigns.</p> : (
          <ul className="world-list">
            {worlds.map((world) => (
              <li key={world.id}>
                <div><strong>{world.name}</strong><small>Updated {new Date(world.updatedAt).toLocaleString()}</small></div>
                <button type="button" onClick={() => void openWorld(world.id)}>Open</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
