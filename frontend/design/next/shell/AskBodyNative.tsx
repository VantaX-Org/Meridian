"use client";

import { useRef, useState, type FormEvent } from "react";
import { v2Post } from "@/lib/api/v2/object";
import { failureText } from "@/lib/v2/errors";
import { Mono, V2Link } from "@/design/v2/parts";
import { Button, Chip } from "@/design/next/kit";
import { Icon } from "@/design/next/Icon";
import { t } from "@/lib/v2/i18n";
import "./connect-native.css";

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

type Turn = { question: string; answer?: AskAnswer; error?: string };

const SUGGESTIONS = [() => t("What is holding the score down?"), () => t("Which objects are under 85?"), () => t("What is the money at risk?"), () => t("What did Aletheia find?")];

/** POST /insights/feedback: one vote per answer. */
function Feedback({ runId }: { runId: string | null }) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (v: "up" | "down") => {
    setBusy(true);
    setError(null);
    try {
      await v2Post("/insights/feedback", { surface: "aletheia", run_id: runId, vote: v });
      setVote(v);
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  if (vote) return <p className="nx-note" role="status">{t("Thanks, your feedback is recorded.")}</p>;
  return (
    <div className="nx-cn-acts" role="group" aria-label={t("Was this answer helpful?")}>
      <span className="nx-note">{t("Was this answer helpful?")}</span>
      <Button variant="quiet" size={32} disabled={busy} onClick={() => void send("up")}>{t("Helpful")}</Button>
      <Button variant="quiet" size={32} disabled={busy} onClick={() => void send("down")}>{t("Not helpful")}</Button>
      {error ? <span role="alert" className="nx-cd-err">{error}</span> : null}
    </div>
  );
}

/** One answer: the grounding verdict, the text, the facts it used, and where to go next. An ungrounded answer is a refusal. */
function Answer({ a }: { a: AskAnswer }) {
  const refused = !a.grounded || !a.answer;
  const max = Math.max(...(a.data ?? []).map((d) => Math.abs(d.value)), 1);
  return (
    <article className="nx-ask-a" data-refused={refused ? "1" : undefined} data-testid="ask-answer">
      <header className="nx-cn-acts">
        <Chip tone={refused ? "warn" : "good"}>{refused ? t("Not answered") : t("Grounded, every number matches a fact")}</Chip>
        <Chip>{t("Intent: {intent}", { intent: a.intent })}</Chip>
        {a.phrased ? <Chip tone="aletheia">{t("Reworded by model")}</Chip> : null}
        {a.version_id ? <Mono>{a.version_id}</Mono> : null}
      </header>
      <p>{refused ? t("The numbers in the draft answer did not match this run's facts, so it was withheld.") : a.answer}</p>
      {!refused && a.data?.length ? (
        <ul className="nx-ask-bars" aria-label={t("Figures in the answer")}>
          {a.data.map((d) => (
            <li key={d.label}>
              <span>{d.label}</span>
              <span className="nx-ask-bar" aria-hidden="true"><span style={{ width: `${(Math.abs(d.value) / max) * 100}%` }} /></span>
              <span className="nx-ask-v">{d.value.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {a.facts.length ? (
        <section aria-label={t("Facts used")}>
          <h3>{t("Facts used")}</h3>
          <dl className="nx-ask-facts">
            {a.facts.map((f) => (
              <div key={f.statement}>
                <dt>{f.href ? <V2Link href={f.href}>{f.statement}</V2Link> : f.statement}</dt>
                <dd>{f.source}</dd>
              </div>
            ))}
          </dl>
          <p className="nx-note">{t("Coverage: {pct}% of the question", { pct: Math.round(a.coverage * 100) })}</p>
        </section>
      ) : null}
      {a.citations.length ? (
        <p className="nx-cn-acts">
          {t("Rules cited")}
          {a.citations.map((c) => <V2Link key={c.check_id} href={c.href}><Mono>{c.check_id}</Mono></V2Link>)}
        </p>
      ) : null}
      <Feedback runId={a.version_id ?? null} />
      {a.links.length ? (
        <footer className="nx-cn-acts">
          {a.links.map((l) => <V2Link key={l.href} href={l.href}>{l.label}</V2Link>)}
        </footer>
      ) : null}
    </article>
  );
}

/** Ask Meridian: the log, the suggested questions and the input. Answers use only the current run's facts. */
export function AskBodyNative({ hero = true }: { hero?: boolean }) {
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
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(text); };

  return (
    <div className="nx-ask">
      {hero ? <div className="nx-ask-hero" aria-hidden="true"><Icon name="sparkles" size={28} /></div> : null}
      <div className="nx-ask-log" aria-live="polite" aria-busy={busy}>
        {turns.map((x, i) => (
          <div key={i}>
            <p className="nx-ask-q">{x.question}</p>
            {x.answer ? <Answer a={x.answer} /> : x.error ? (
              <p role="alert" className="nx-cd-err">{x.error} <Button variant="quiet" size={32} disabled={busy} onClick={() => void ask(x.question)}>{t("Try again")}</Button></p>
            ) : <p className="nx-note">{t("Reading the facts")}</p>}
          </div>
        ))}
      </div>
      <form className="nx-ask-dock" onSubmit={submit}>
        <div className="nx-cn-acts">
          {SUGGESTIONS.map((s) => <Button key={s()} variant="secondary" size={32} disabled={busy} onClick={() => void ask(s())}>{s()}</Button>)}
        </div>
        <div className="nx-ask-in">
          <input ref={input} className="nx-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label={t("Your question")} placeholder={t("Ask about this run")} />
          <Button variant="primary" type="submit" disabled={busy || !text.trim()}>{t("Ask")}</Button>
        </div>
      </form>
    </div>
  );
}
