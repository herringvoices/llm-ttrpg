import { useEffect, useState } from "react";
import type { CharacterSheetView } from "./character-sheet.js";

type SheetTab = "overview" | "attributes" | "skills" | "powers";

export function CharacterSheet({
  name, sheet, onClose,
}: {
  readonly name: string;
  readonly sheet?: CharacterSheetView;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<SheetTab>("overview");
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="character-sheet-backdrop">
      <section className="character-sheet" role="dialog" aria-modal="true" aria-labelledby="character-sheet-title">
        <header className="sheet-header">
          <div>
            <p className="eyebrow">Character</p>
            <h2 id="character-sheet-title">{name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close character sheet">Close</button>
        </header>
        {!sheet ? (
          <p>Character mechanics are not available in this save yet.</p>
        ) : (
          <>
            <nav className="sheet-tabs" aria-label="Character sheet sections">
              {(["overview", "attributes", "skills", "powers"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={tab === item}
                  onClick={() => setTab(item)}
                >{item.charAt(0).toUpperCase() + item.slice(1)}</button>
              ))}
            </nav>
            <div className="sheet-body">
              {tab === "overview" && (
                <>
                  <div className="sheet-metrics">
                    <div><small>Level</small><strong>{sheet.level}</strong></div>
                    {sheet.xp !== undefined && <div><small>XP</small><strong>{sheet.xp}</strong><span>{sheet.xpToNextLevel} to next level</span></div>}
                    {sheet.mana && <div><small>Mana</small><strong>{sheet.mana.current} / {sheet.mana.max}</strong></div>}
                  </div>
                  <h3>Stress</h3>
                  <div className="sheet-stress">
                    {sheet.stress.map((track) => (
                      <div key={track.name}><span>{track.name}</span><strong>{track.value} / 5</strong></div>
                    ))}
                  </div>
                  <h3>Active statuses</h3>
                  {sheet.statuses.length === 0
                    ? <p className="sheet-muted">No active statuses.</p>
                    : sheet.statuses.map((status) => (
                      <article key={status.id} className="sheet-item">
                        <strong>{status.name}</strong><p>{status.description}</p>
                      </article>
                    ))}
                </>
              )}
              {tab === "attributes" && sheet.attributeGroups.map((group) => (
                <div key={group.name}>
                  <h3>{group.name}</h3>
                  <div className="sheet-attributes">
                    {group.attributes.map((attribute) => (
                      <div key={attribute.name}><span>{attribute.name}</span><strong>{attribute.value}</strong></div>
                    ))}
                  </div>
                </div>
              ))}
              {tab === "skills" && (
                sheet.skills.length === 0
                  ? <p className="sheet-muted">No skills recorded yet.</p>
                  : sheet.skills.map((skill) => (
                    <article key={skill.id} className="sheet-item">
                      <div className="sheet-item-heading">
                        <strong>{skill.name}</strong>
                        <span>Level {skill.level} · {skill.rank}</span>
                      </div>
                      <p>{skill.description}</p>
                      <small>{skill.sp} SP · {skill.spToNext} SP to next level</small>
                    </article>
                  ))
              )}
              {tab === "powers" && (
                sheet.powers.length === 0
                  ? <p className="sheet-muted">No powers manifested yet.</p>
                  : sheet.powers.map((power) => (
                    <article key={power.id} className="sheet-item sheet-power">
                      <div className="sheet-item-heading">
                        <h3>{power.name}</h3><span>Level {power.level} · {power.pp} PP</span>
                      </div>
                      <p>{power.corePrinciple}</p>
                      {power.functions.map((fn) => (
                        <div key={fn.id} className="sheet-function">
                          <h4>{fn.name}</h4>
                          <p>{fn.description}</p>
                          <small>Mana cost: {fn.manaCost} · Activation: {fn.activationTimeMs} ms</small>
                          {fn.conditions.length > 0 && <p><b>Conditions:</b> {fn.conditions.join("; ")}</p>}
                          {fn.targets.length > 0 && <p><b>Targets:</b> {fn.targets.join("; ")}</p>}
                          {fn.limits.length > 0 && <p><b>Limits:</b> {fn.limits.join("; ")}</p>}
                        </div>
                      ))}
                      {power.discoveries.length > 0 && (
                        <details>
                          <summary>Discovered interactions ({power.discoveries.length})</summary>
                          {power.discoveries.map((discovery, index) => (
                            <p key={index}><b>{discovery.question}</b> ({discovery.outcome}): {discovery.ruling}</p>
                          ))}
                        </details>
                      )}
                    </article>
                  ))
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
