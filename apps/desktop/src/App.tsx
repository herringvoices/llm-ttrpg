import { useEffect, useRef, useState } from "react";
import type { WorldMetadata } from "@llm-ttrpg/engine";
import type {
  CampaignCreationProgress,
  CampaignGenerationDraft,
  CampaignFollowUpQuestion,
  DesktopApplication,
} from "./application.js";
import type { DesktopPlaySession, PlaySessionView } from "./play-session.js";

export function App({ application }: { readonly application: DesktopApplication }) {
  const [worlds, setWorlds] = useState<readonly WorldMetadata[]>([]);
  const [drafts, setDrafts] = useState<readonly CampaignGenerationDraft[]>([]);
  const [characterName, setCharacterName] = useState("");
  const [sexGender, setSexGender] = useState("");
  const [appearance, setAppearance] = useState("");
  const [location, setLocation] = useState("");
  const [hobbies, setHobbies] = useState("");
  const [bioHistory, setBioHistory] = useState("");
  const [message, setMessage] = useState("Loading campaigns…");
  const [creating, setCreating] = useState(false);
  const [allowGeneratedDetails, setAllowGeneratedDetails] = useState(true);
  const [followUps, setFollowUps] = useState<readonly CampaignFollowUpQuestion[]>([]);
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>({});
  const [generateUnanswered, setGenerateUnanswered] = useState(true);
  const [activeDraftId, setActiveDraftId] = useState<string>();
  const [generationProgress, setGenerationProgress] = useState<CampaignCreationProgress>();
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const [openingWorldId, setOpeningWorldId] = useState<string>();
  const [deletingWorldId, setDeletingWorldId] = useState<string>();
  const [playSession, setPlaySession] = useState<DesktopPlaySession>();
  const [playView, setPlayView] = useState<PlaySessionView>();
  const [declaration, setDeclaration] = useState("");
  const transcriptEnd = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [loaded, savedDrafts] = await Promise.all([
      application.listWorlds(),
      application.listCampaignDrafts(),
    ]);
    setWorlds(loaded);
    setDrafts(savedDrafts);
    const campaignSummary = loaded.length === 0 ? "No campaigns yet." : `${loaded.length} campaign(s).`;
    setMessage(savedDrafts.length === 0
      ? campaignSummary
      : `${campaignSummary} ${savedDrafts.length} setup draft(s) can be resumed.`);
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Unable to load campaigns");
    });
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [playView?.transcript.length]);

  useEffect(() => {
    if (!creating) return;
    const startedAt = Date.now();
    setGenerationElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setGenerationElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [creating]);

  function followUpKey(question: CampaignFollowUpQuestion): string {
    return `${question.scope}:${question.id}`;
  }

  function formatElapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
  }

  function progressOptions() {
    return {
      onProgress(progress: CampaignCreationProgress) {
        setGenerationProgress(progress);
        setMessage(progress.label);
      },
    };
  }

  function acceptCreationResult(
    result: Awaited<ReturnType<DesktopApplication["createCampaign"]>>,
  ): boolean {
    if (result.kind === "needs-input") {
      setActiveDraftId(result.draftId);
      setFollowUps(result.questions);
      setFollowUpAnswers({});
      setMessage("A few choices need your input before generation continues.");
      return false;
    }
    setActiveDraftId(undefined);
    setFollowUps([]);
    setPlaySession(result.session);
    setPlayView(result.session.view());
    return true;
  }

  async function createWorld() {
    setCreating(true);
    setGenerationProgress(undefined);
    setMessage("Preparing campaign generation…");
    try {
      const result = await application.createCampaign({
        characterName,
        sexGender,
        appearance,
        locationDescription: location,
        hobbies,
        bioHistory,
        allowGeneratedDetails,
      }, progressOptions());
      if (acceptCreationResult(result)) await refresh();
      else setDrafts(await application.listCampaignDrafts());
    } catch (error) {
      setDrafts(await application.listCampaignDrafts());
      setMessage(error instanceof Error ? error.message : "Unable to create campaign");
    } finally {
      setCreating(false);
    }
  }

  async function openWorld(worldId: string) {
    if (openingWorldId || deletingWorldId) return;
    setOpeningWorldId(worldId);
    setMessage("Opening campaign…");
    try {
      const session = await application.openWorld(worldId);
      setPlaySession(session);
      setPlayView(session.view());
      const pending = session.prepareOpening();
      setPlayView(session.view());
      setPlayView(await pending);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to open campaign");
    } finally {
      setOpeningWorldId(undefined);
    }
  }

  async function deleteWorld(world: WorldMetadata) {
    if (openingWorldId || deletingWorldId) return;
    if (!window.confirm(`Permanently remove "${world.name}"? This cannot be undone.`)) return;
    setDeletingWorldId(world.id);
    setMessage(`Deleting ${world.name}…`);
    try {
      const result = await application.deleteWorld(world.id);
      if (!result.deleted) {
        setMessage(`${world.name} was already deleted.`);
      } else {
        await refresh();
        setMessage(`Deleted ${world.name}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove campaign");
    } finally {
      setDeletingWorldId(undefined);
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

  async function submitFollowUps() {
    const answers = followUps.map((question) => ({
      ...question,
      answer: followUpAnswers[followUpKey(question)]?.trim() ?? "",
    })).filter((answer) => answer.answer.length > 0);
    if (!activeDraftId) return;
    setCreating(true);
    setGenerationProgress(undefined);
    setMessage("Continuing saved campaign setup...");
    try {
      const result = await application.answerCampaignQuestions(
        activeDraftId,
        answers,
        generateUnanswered,
        progressOptions(),
      );
      if (acceptCreationResult(result)) await refresh();
      else setDrafts(await application.listCampaignDrafts());
    } catch (error) {
      setDrafts(await application.listCampaignDrafts());
      setMessage(error instanceof Error ? error.message : "Unable to continue campaign setup");
    } finally {
      setCreating(false);
    }
  }

  async function resumeDraft(draft: CampaignGenerationDraft) {
    if (draft.status === "needs-input" && draft.questions.length > 0) {
      setCharacterName(draft.input.characterName ?? "");
      setSexGender(draft.input.sexGender ?? "");
      setAppearance(draft.input.appearance ?? "");
      setLocation(draft.input.locationDescription);
      setHobbies(draft.input.hobbies ?? "");
      setBioHistory(draft.input.bioHistory ?? draft.input.playerDescription ?? "");
      setGenerateUnanswered(draft.input.allowGeneratedDetails ?? true);
      setFollowUpAnswers(Object.fromEntries(
        (draft.input.followUpAnswers ?? []).map((answer) => [followUpKey(answer), answer.answer]),
      ));
      setFollowUps(draft.questions);
      setActiveDraftId(draft.id);
      setMessage("Continue the saved setup questions below.");
      return;
    }
    setCreating(true);
    setGenerationProgress(undefined);
    setMessage(`Resuming ${draft.name}...`);
    try {
      const result = await application.resumeCampaign(draft.id, progressOptions());
      if (acceptCreationResult(result)) await refresh();
      else setDrafts(await application.listCampaignDrafts());
    } catch (error) {
      setDrafts(await application.listCampaignDrafts());
      setMessage(error instanceof Error ? error.message : "Unable to resume campaign setup");
    } finally {
      setCreating(false);
    }
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
            <p className="empty-copy">
              {playView.preparingOpening
                ? "Preparing your opening scene…"
                : "The world is ready. Describe what you do or say."}
            </p>
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
            {playView.preparingOpening
              ? "Preparing opening…"
              : playView.busy ? "Resolving…" : "Continue"}
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
      {followUps.length === 0 ? (
        <section aria-labelledby="new-world-heading">
          <h2 id="new-world-heading">Begin a campaign</h2>
          <label>
            Name
            <input required disabled={creating} value={characterName} onChange={(event) => setCharacterName(event.target.value)} />
          </label>
          <label>
            Sex/Gender
            <input disabled={creating} value={sexGender} onChange={(event) => setSexGender(event.target.value)} />
          </label>
          <label>
            Appearance
            <textarea
              disabled={creating}
              value={appearance}
              placeholder="What does your character look like? Include as much or as little detail as you want."
              onChange={(event) => setAppearance(event.target.value)}
            />
          </label>
          <label>
            Location
            <textarea
              required
              disabled={creating}
              value={location}
              placeholder="Where does your character live or where should the story begin? A city, region, neighborhood, type of community, or made-up place is fine."
              onChange={(event) => setLocation(event.target.value)}
            />
          </label>
          <label>
            Hobbies
            <input disabled={creating} value={hobbies} onChange={(event) => setHobbies(event.target.value)} />
          </label>
          <label>
            Bio / History
            <textarea
              disabled={creating}
              value={bioHistory}
              placeholder="Tell us as much or as little as you want about your character's life so far: work or school, relationships, goals, history, routines, or anything else that matters."
              onChange={(event) => setBioHistory(event.target.value)}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              disabled={creating}
              checked={allowGeneratedDetails}
              onChange={(event) => setAllowGeneratedDetails(event.target.checked)}
            />
            <span>
              Let the GM invent unspecified details
              <small>Grounded choices will be generator-created, not treated as facts you supplied.</small>
            </span>
          </label>
          <button
            type="button"
            disabled={creating || !characterName.trim() || !location.trim()}
            onClick={() => void createWorld()}
          >
            {creating ? "Generating…" : "Create campaign"}
          </button>
          {creating && generationProgress && (
            <div className="generation-progress" role="status" aria-live="polite">
              <div>
                <strong>{generationProgress.label}</strong>
                <span>Step {generationProgress.current} of {generationProgress.total}</span>
              </div>
              <progress value={generationProgress.current} max={generationProgress.total} />
              <small>
                Elapsed {formatElapsed(generationElapsedSeconds)} · Each model attempt stops after 20 minutes; accepted steps are saved.
              </small>
            </div>
          )}
        </section>
      ) : (
        <section className="follow-up-panel" aria-labelledby="follow-up-heading">
          <p className="eyebrow">Campaign setup</p>
          <h2 id="follow-up-heading">A few details would materially shape the game</h2>
          <p>Answer what matters to you. The GM can make grounded choices for anything you leave blank.</p>
          {followUps.map((question) => (
            <label key={followUpKey(question)}>
              {question.question}
              <small>{question.materialImpact}</small>
              <textarea
                disabled={creating}
                value={followUpAnswers[followUpKey(question)] ?? ""}
                onChange={(event) => setFollowUpAnswers((current) => ({
                  ...current,
                  [followUpKey(question)]: event.target.value,
                }))}
              />
            </label>
          ))}
          <label className="checkbox-row">
            <input
              type="checkbox"
              disabled={creating}
              checked={generateUnanswered}
              onChange={(event) => setGenerateUnanswered(event.target.checked)}
            />
            <span>Let the GM decide any answers I leave blank</span>
          </label>
          <div className="follow-up-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={creating}
              onClick={() => {
                setFollowUps([]);
                setFollowUpAnswers({});
                setActiveDraftId(undefined);
              }}
            >
              Back
            </button>
            <button
              type="button"
              disabled={creating || (!generateUnanswered && followUps.some((question) =>
                !(followUpAnswers[followUpKey(question)]?.trim())
              ))}
              onClick={() => void submitFollowUps()}
            >
              {creating ? "Continuing generation…" : "Continue generation"}
            </button>
          </div>
          {creating && generationProgress && (
            <div className="generation-progress" role="status" aria-live="polite">
              <div>
                <strong>{generationProgress.label}</strong>
                <span>Step {generationProgress.current} of {generationProgress.total}</span>
              </div>
              <progress value={generationProgress.current} max={generationProgress.total} />
              <small>Elapsed {formatElapsed(generationElapsedSeconds)} · Each model attempt stops after 20 minutes.</small>
            </div>
          )}
        </section>
      )}
      {drafts.length > 0 && followUps.length === 0 && (
        <section aria-labelledby="drafts-heading">
          <h2 id="drafts-heading">Resume campaign setup</h2>
          <p className="section-copy">
            Accepted generation steps are saved. Resuming starts with the first unfinished step.
          </p>
          <ul className="world-list">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <div>
                  <strong>{draft.name}</strong>
                  <small>
                    {draft.status === "needs-input"
                      ? "Waiting for your answers"
                      : draft.status === "failed"
                        ? `Paused after an error${draft.lastCompletedStageId ? `; completed ${draft.lastCompletedStageId}` : ""}`
                        : `Paused${draft.lastCompletedStageId ? ` after ${draft.lastCompletedStageId}` : " before the first step"}`}
                  </small>
                  {draft.errorMessage && <small className="draft-error">{draft.errorMessage}</small>}
                  <small>Saved {new Date(draft.updatedAt).toLocaleString()}</small>
                </div>
                <button type="button" disabled={creating} onClick={() => void resumeDraft(draft)}>
                  {draft.status === "needs-input" ? "Continue setup" : "Resume"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="worlds-heading">
        <h2 id="worlds-heading">Continue</h2>
        {worlds.length === 0 ? <p>No saved campaigns.</p> : (
          <ul className="world-list">
            {worlds.map((world) => (
              <li key={world.id}>
                <div><strong>{world.name}</strong><small>Updated {new Date(world.updatedAt).toLocaleString()}</small></div>
                <div className="world-actions">
                  <button
                    type="button"
                    disabled={Boolean(openingWorldId || deletingWorldId)}
                    onClick={() => void openWorld(world.id)}
                  >
                    {openingWorldId === world.id ? "Opening…" : "Open"}
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={Boolean(openingWorldId || deletingWorldId)}
                    onClick={() => void deleteWorld(world)}
                  >
                    {deletingWorldId === world.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
