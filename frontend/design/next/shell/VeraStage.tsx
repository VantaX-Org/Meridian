"use client";

import { useEffect, type ChangeEvent } from "react";
import { Button } from "@/design/next/kit";
import { Icon } from "@/design/next/Icon";
import { t } from "@/lib/v2/i18n";
import "./vera-stage.css";

export type VoiceId = "vera" | "bright" | "composed";

export interface VeraStageProps {
  density: "hero" | "compact";
  /** speaking while a turn streams, idle otherwise */
  state: "idle" | "speaking";
  /** already lowercased by the caller */
  scope: string;
  voice: VoiceId;
  onVoice: (v: VoiceId) => void;
  /** focuses the ask input; no TTS endpoint exists (gap V1) */
  onTalk: () => void;
  /** omitted: no Preview control (gap V1) */
  onPreview?: () => void;
  /** omitted: no tier label (gap V1) */
  tier?: string;
}

export const VOICE_KEY = "nx.vera.voice";
const VOICES: VoiceId[] = ["vera", "bright", "composed"];
const isVoice = (v: unknown): v is VoiceId => VOICES.includes(v as VoiceId);

/** The saved voice, or null when storage is blocked or empty. */
export function readVoice(): VoiceId | null {
  try {
    const v = window.localStorage.getItem(VOICE_KEY);
    return isVoice(v) ? v : null;
  } catch {
    return null;
  }
}

export function VeraStage({ density, state, scope, voice, onVoice, onTalk, onPreview, tier }: VeraStageProps) {
  const hero = density === "hero";

  // Restore the saved choice once; the parent owns the value.
  useEffect(() => {
    const saved = readVoice();
    if (saved && saved !== voice) onVoice(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (!isVoice(v)) return;
    try {
      window.localStorage.setItem(VOICE_KEY, v);
    } catch {
      /* storage blocked: the choice lasts for this session only */
    }
    onVoice(v);
  };

  const labels: Record<VoiceId, string> = { vera: t("Vera"), bright: t("Vera, bright"), composed: t("Vera, composed") };

  return (
    <section className="nx-vera" data-density={density} data-scope={scope} aria-label={t("Vera")}>
      <div className="nx-vera-3d">
        <div
          className="nx-orb"
          data-state={state}
          role="img"
          aria-label={state === "speaking" ? t("Vera is answering") : t("Vera is listening")}
        >
          <span className="nx-orb-core" />
          <span className="nx-orb-ring" aria-hidden="true" />
        </div>
        <div className="nx-vera-caption">
          <p className="nx-vera-hint">{t("I only say what I can prove. Every figure comes from a check in this run.")}</p>
          <div className="nx-vera-controls">
            <Button variant="primary" size={hero ? 40 : 32} icon="sparkles" onClick={onTalk}>
              {t("Talk to Vera")}
            </Button>
            {hero ? (
              <button type="button" className="nx-icon-btn" aria-label={t("Keyboard: press slash to ask")} onClick={onTalk}>
                <Icon name="command" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {hero ? (
        <div className="nx-vera-voicebar">
          <label className="nx-vera-voice">
            <span>{t("Voice")}</span>
            <select className="nx-input" value={voice} onChange={change}>
              {VOICES.map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </label>
          {onPreview ? (
            <button type="button" className="nx-ask-link" onClick={onPreview}>
              {t("Preview")}
            </button>
          ) : null}
          {tier ? <span className="nx-vera-tier">{tier}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
