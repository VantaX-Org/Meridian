"use client";

import { useRef, useState, type FormEvent } from "react";
import { v2Post } from "@/lib/api/v2/object";
import { failureText } from "@/lib/v2/errors";
import { InspectorFrame } from "../Inspector";
import { Mark } from "../marks";
import { Mono, V2Link } from "../parts";
import { t } from "@/lib/v2/i18n";

/** POST /assistant/ask: an answer assembled from this run's facts, the model only rewords it. */
export interface AskAnswer {
  answer: string;
  intent: string;
  data?: { label: string; value: number }[] | null;
  chart?: "bar" | "line" | null;
  links: { label: string; href: string }[];
  phrased: boolean;
  version_id?: string | null;
  facts: { statement: string; value?: number | null; source: string; href?: string | null; checks: { check_id: string; module?: string }[] }[];
  coverage: number;
  grounded: boolean;
  citations: { check_id: string; module: string; href: string }[];
}

interface Turn {
  question: string;
  answer?: AskAnswer;
  error?: string;
}

const SUGGESTIONS = [() => t("What is holding the score down?"), () => t("Which objects are under 85?"), () => t("What is the money at risk?")];

/** One answer: the grounding verdict, the text, the facts it used, and where to go next. An ungrounded answer is a refusal. */
function Answer({ a }: { a: AskAnswer }) {
  const refused = !a.grounded || !a.answer;
  const max = Math.max(...(a.data ?? []).map((d) => Math.abs(d.value)), 1);
  return (
    <article className="m2-ask-a" data-refused={refused ? "1" : undefined} data-testid="ask-answer">
      <header className="m2-ask-badges">
        <span className="m2-ask-badge" data-tone={refused ? "warn" : "pass"}>
          {refused ? t("Not answered") : t("Grounded, every number matches a fact")}
        </span>
        <span className="m2-ask-badge">{t("Intent: {intent}", { intent: a.intent })}</span>
        {a.phrased ? <span className="m2-ask-badge">{t("Reworded by model")}</span> : null}
        {a.version_id ? <Mono>{a.version_id}</Mono> : null}
      </header>
      <p>{refused ? t("The numbers in the draft answer did not match this run's facts, so it was withheld.") : a.answer}</p>
      {!refused && a.data?.length ? (
        <ul className="m2-ask-bars" aria-label={t("Figures in the answer")}>
          {a.data.map((d) => (
            <li key={d.label}>
              <span>{d.label}</span>
              <span className="m2-ask-bar" aria-hidden="true">
                <span style={{ width: `${(Math.abs(d.value) / max) * 100}%` }} />
              </span>
              <span className="m2-v">{d.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {a.facts.length ? (
        <section aria-label={t("Facts used")}>
          <h3>{t("Facts used")}</h3>
          <dl className="m2-ask-facts">
            {a.facts.map((f) => (
              <div key={f.statement}>
                <dt>{f.href ? <V2Link href={f.href}>{f.statement}</V2Link> : f.statement}</dt>
                <dd>{f.source}</dd>
              </div>
            ))}
          </dl>
          <p className="m2-ask-cov">{t("Coverage: {pct}% of the question", { pct: Math.round(a.coverage * 100) })}</p>
        </section>
      ) : null}
      {a.citations.length ? (
        <p className="m2-ask-cites">
          {t("Rules cited")}{" "}
          {a.citations.map((c) => (
            <V2Link key={c.check_id} href={c.href} className="m2-mono">
              {c.check_id}
            </V2Link>
          ))}
        </p>
      ) : null}
      {a.links.length ? (
        <footer className="m2-ask-links">
          {a.links.map((l) => (
            <V2Link key={l.href} href={l.href} className="m2-btn">
              {l.label}
            </V2Link>
          ))}
        </footer>
      ) : null}
    </article>
  );
}

/** `?open=ask`: Ask Meridian. Answers use only the current run's facts; any number that is not a fact is refused. */
export function AskPanel({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setText("");
    const i = turns.length;
    setTurns((p) => [...p, { question: q }]);
    try {
      const answer = await v2Post<AskAnswer>("/assistant/ask", { question: q, scope: "current" });
      setTurns((p) => p.map((x, k) => (k === i ? { ...x, answer } : x)));
    } catch (e) {
      setTurns((p) => p.map((x, k) => (k === i ? { ...x, error: failureText(e) } : x)));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };

  return (
    <InspectorFrame title={t("Ask Meridian")} status={t("Answers use only this run's facts. The model rewords them; any number that is not a fact is refused.")} onClose={onClose}>
      <div className="m2-ask">
        <div className="m2-ask-hero">
          <Mark size={40} />
        </div>
        <div className="m2-ask-log" aria-live="polite" aria-busy={busy}>
          {turns.map((x, i) => (
            <div key={i}>
              <p className="m2-ask-q">{x.question}</p>
              {x.answer ? <Answer a={x.answer} /> : x.error ? <p role="alert">{x.error}</p> : <p>{t("Reading the facts")}</p>}
            </div>
          ))}
        </div>
        <form className="m2-ask-dock" onSubmit={submit}>
          <div className="m2-ask-chips">
            {SUGGESTIONS.map((s) => (
              <button key={s()} type="button" className="m2-btn" onClick={() => void ask(s())} disabled={busy}>
                {s()}
              </button>
            ))}
          </div>
          <div className="m2-ask-in">
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label={t("Your question")} placeholder={t("Ask about this run")} />
            <button type="submit" className="m2-btn m2-next" disabled={busy || !text.trim()}>
              {t("Ask")}
            </button>
          </div>
        </form>
      </div>
    </InspectorFrame>
  );
}
