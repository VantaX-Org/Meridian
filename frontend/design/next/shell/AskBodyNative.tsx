"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { v2Post } from "@/lib/api/v2/object";
import { askStream, getSuggestions, type AskEvidence } from "@/lib/api/v2/assistant";
import { failureText } from "@/lib/v2/errors";
import { Mono, V2Link } from "@/design/v2/parts";
import { Button, Chip } from "@/design/next/kit";
import { Skeleton } from "@/design/next/kit/Skeleton";
import { Icon, type IconName } from "@/design/next/Icon";
import { t } from "@/lib/v2/i18n";
import { AreaTrend, RankedBars, Stat, StackedBar, VizLegend, vizNum, vizSigned } from "../viz";
import { pickViz, type Viz } from "./pickViz";
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
  facts: { statement: string; value?: number | null; source: string; href?: string | null; checks: { check_id: string; module?: string | null }[] }[];
  coverage: number;
  grounded: boolean;
  citations: { check_id: string; module?: string | null; href: string }[];
}

type Fact = AskAnswer["facts"][number];
type Turn = { id: number; question: string; evidence?: AskEvidence; text: string; answer?: AskAnswer; error?: string };

/** Fallback only: the real chips come from GET /assistant/suggestions. */
const SUGGESTIONS = [() => t("What is holding the score down?"), () => t("Which objects are under 85?"), () => t("What is the money at risk?"), () => t("What did Aletheia find?")];
const MAX_CELLS = 24;

/** An ungrounded or empty answer is a refusal: its prose and chart are never shown. */
const isRefused = (a: Pick<AskAnswer, "grounded" | "answer">) => !a.grounded || !a.answer.trim();

const rowId = (turn: number, n: number) => `ask-${turn}-fact-${n}`;

/**
 * Client-side citation (the API has no span map, gap E3): the first place each fact's number appears in the answer
 * gets an F-n marker after it. A fact with no number, or whose number is not in the text, is never cited.
 */
export function citeFacts(answer: string, facts: Fact[]): { parts: (string | number)[]; cited: Set<number> } {
  const hits: { at: number; n: number }[] = [];
  facts.forEach((f, i) => {
    if (f.value == null || !Number.isFinite(f.value)) return;
    const forms = new Set([vizNum(f.value), String(f.value), f.value.toFixed(2)]);
    let best = -1;
    for (const form of forms) {
      const esc = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = new RegExp(`(?<![\\d.,])${esc}(?:%)?(?![\\d]|[.,]\\d)`).exec(answer);
      if (m && (best < 0 || m.index + m[0].length < best)) best = m.index + m[0].length;
    }
    if (best >= 0) hits.push({ at: best, n: i + 1 });
  });
  hits.sort((a, b) => a.at - b.at || a.n - b.n);
  const parts: (string | number)[] = [];
  let pos = 0;
  for (const h of hits) {
    parts.push(answer.slice(pos, h.at), h.n);
    pos = h.at;
  }
  parts.push(answer.slice(pos));
  return { parts, cited: new Set(hits.map((h) => h.n)) };
}

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

/** 1. The fact graph: one cell per fact, shaded by whether it carries a figure, outlined when the answer cites it. */
function FactGraphCard({ turn, facts, coverage, cited, pending, refused, onPick }: { turn: number; facts: Fact[]; coverage: number; cited: Set<number>; pending: boolean; refused: boolean; onPick: (n: number) => void }) {
  const cov = coverage.toFixed(2);
  const title = refused ? t("Fact graph, withheld") : t("Fact graph");
  if (!facts.length) {
    return (
      <section className="nx-ask-card" aria-label={title}>
        <p className="nx-note">{pending ? t("Reading the facts") : t("No facts in this run speak to that.")}</p>
      </section>
    );
  }
  const shown = facts.length > MAX_CELLS ? facts.slice(0, MAX_CELLS - 1) : facts;
  const extra = facts.length - shown.length;
  return (
    <section className="nx-ask-card" aria-label={title} data-testid="fact-graph">
      <header className="nx-ask-head">
        <h3 className="nx-ask-title">{title}</h3>
        <span className="nx-ask-meta">
          {pending ? t("Reading {n} facts", { n: facts.length }) : t("{n} facts answer it", { n: facts.length })}
          <span className="nx-ask-hair" aria-hidden="true" />
          {t("coverage {c}", { c: cov })}
        </span>
      </header>
      <div className="nx-ask-grid" role="group" aria-label={title}>
        {shown.map((f, i) => {
          const n = i + 1;
          const name = `F${n}: ${f.statement}`;
          return (
            <button
              key={n}
              type="button"
              className="nx-ask-cell"
              data-state={f.value == null ? "text" : "value"}
              data-cited={cited.has(n) ? "1" : undefined}
              data-withheld={refused ? "1" : undefined}
              style={{ animationDelay: `${i * 12}ms` }}
              aria-label={name}
              title={name}
              onClick={() => onPick(n)}
            />
          );
        })}
        {extra > 0 ? <span className="nx-ask-more">{`+${extra}`}</span> : null}
      </div>
      <ul className="nx-ask-legend">
        <li><span className="nx-ask-sw" data-state="value" />{t("Has a figure")}</li>
        <li><span className="nx-ask-sw" data-state="text" />{t("Statement only")}</li>
        <li><span className="nx-ask-sw" data-state="value" data-cited="1" />{t("In the answer")}</li>
      </ul>
      <div className="nx-ask-cov" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(1, coverage)) * 100}%` }} /></div>
      <span className="nx-sr" data-turn={turn} />
    </section>
  );
}

/** 2. The prose: streamed while the model writes, then the full answer with F-n markers. Never rendered for a refusal. */
function Prose({ text, answer, facts, turn, streaming, onPick }: { text: string; answer?: AskAnswer; facts: Fact[]; turn: number; streaming: boolean; onPick: (n: number) => void }) {
  const body: ReactNode = answer
    ? citeFacts(answer.answer, facts).parts.map((p, i) =>
        typeof p === "number" ? (
          <button key={i} type="button" className="nx-ask-cite" aria-label={t("Fact {n}: {statement}", { n: p, statement: facts[p - 1].statement })} onClick={() => onPick(p)}><sup>{`F${p}`}</sup></button>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )
    : text;
  return (
    <div className="nx-ask-prose" data-turn={turn}>
      <p>{body}{streaming ? <span className="nx-ask-caret" aria-hidden="true" /> : null}</p>
      {answer?.phrased ? <small className="nx-ask-meta">{t("Reworded by the model from these facts")}</small> : null}
    </div>
  );
}

/** 3. The verdict, in words and shape, under the prose. */
function VerifyChip({ a }: { a: AskAnswer }) {
  const refused = isRefused(a);
  const cov = a.coverage.toFixed(2);
  return (
    <div className="nx-cn-acts">
      <Chip tone={refused ? "warn" : "good"}>
        {refused ? t("Withheld, coverage {c}, {n} facts, not grounded", { c: cov, n: a.facts.length }) : t("Verified, coverage {c}, {n} facts, grounded", { c: cov, n: a.facts.length })}
      </Chip>
      {a.version_id ? <Mono className="nx-ask-run">{a.version_id}</Mono> : null}
    </div>
  );
}

/** One card per pickViz kind: icon and title, the chart, the caption in words. */
function vizCard(v: Viz, a: AskAnswer, scrollToRecord: () => void): { icon: IconName; title: string; body: ReactNode; caption: ReactNode } | null {
  const cap = (text: string) => <small className="nx-ask-cap">{text}</small>;
  switch (v.kind) {
    case "none":
      return null;
    case "trend": {
      const f = v.points[0];
      const l = v.points[v.points.length - 1];
      const text = v.points.every((p) => p.value === f.value)
        ? t("Unchanged across {n} runs", { n: v.points.length })
        : t("{from} to {to}: {a} → {b} ({change})", { from: f.label, to: l.label, a: vizNum(f.value), b: vizNum(l.value), change: vizSigned(l.value - f.value) });
      return {
        icon: "arrow-up-right",
        title: t("How it moved"),
        body: (
          <>
            <p className="nx-ask-annot"><b>{vizNum(l.value)}</b><span>{vizSigned(l.value - f.value)}</span></p>
            <AreaTrend points={v.points} label={text} height={96} empty={text} emphasisLast />
          </>
        ),
        caption: cap(text),
      };
    }
    case "stack": {
      const tot = v.total.value;
      const pct = (n: number) => (tot ? Math.round((n / tot) * 100) : 0);
      const last = v.segs[v.segs.length - 1];
      const text = tot === 0 ? t("Nothing in the funnel yet") : t("{total} {label}: {last} {value} ({pct}%)", { total: vizNum(tot), label: v.total.label, last: last.label, value: vizNum(last.value), pct: pct(last.value) });
      const tones = ["chart1", "chart2", "chart3"] as const;
      const segs = v.segs.map((s, i) => ({ id: s.label, label: s.label, value: s.value, tone: tones[i] ?? ("mute" as const) }));
      return {
        icon: "columns",
        title: t("Where the {total} go", { total: v.total.label }),
        body: <><StackedBar segs={segs} label={text} /><VizLegend items={segs.map((s) => ({ ...s, note: t("({pct}% of {total})", { pct: pct(s.value), total: v.total.label }) }))} /></>,
        caption: cap(text),
      };
    }
    case "ranked": {
      const zero = v.items.every((d) => d.value === 0);
      const top = v.items[0];
      const text = zero ? t("All {n} are zero", { n: v.items.length }) : t("Highest: {label}, {value}", { label: top.label, value: vizNum(top.value) }) + (v.more ? t(", {n} more in the facts", { n: v.more }) : "");
      return {
        icon: "arrow-down",
        title: v.keepOrder ? t("In order") : t("Biggest first"),
        body: <RankedBars items={v.items} label={text} emphasis={zero ? "none" : v.keepOrder ? "first" : "top"} />,
        caption: (
          <>
            {cap(text)}
            {v.more > 0 ? <> <button type="button" className="nx-ask-link" onClick={scrollToRecord}>{t("see all in the record")}</button></> : null}
          </>
        ),
      };
    }
    case "stat": {
      const text = v.figures.map((f) => `${f.label} ${vizNum(f.value)}`).join(", ");
      const two = v.figures.length === 2;
      return {
        icon: two ? "columns" : "info",
        title: two ? t("{a} against {b}", { a: v.figures[0].label, b: v.figures[1].label }) : v.figures[0].label,
        body: <Stat figures={v.figures} label={text} delta={v.delta} />,
        caption: cap(text),
      };
    }
  }
  void a;
}

/** 5. The one lead visual, chosen from the real result. Never for a refusal. */
function LivingVizCard({ a, scrollToRecord }: { a: AskAnswer; scrollToRecord: () => void }) {
  if (isRefused(a)) return null;
  const v = pickViz(a);
  const card = vizCard(v, a, scrollToRecord);
  if (!card) return null;
  const src = [a.intent, t("{n} facts", { n: a.facts.length }), a.version_id ?? t("current run")];
  if (a.facts[0]?.source) src.push(a.facts[0].source);
  return (
    <section className="nx-ask-card nx-ask-viz" data-viz={v.kind} aria-label={card.title}>
      <header className="nx-ask-head">
        <h3 className="nx-ask-title"><Icon name={card.icon} />{card.title}</h3>
      </header>
      <small className="nx-ask-src">{src.join(", ")}</small>
      {card.body}
      {card.caption}
    </section>
  );
}

/** 6. On the record: every fact with its source and the rules behind it. */
function OnTheRecord({ turn, a, cited, hot }: { turn: number; a: AskAnswer; cited: Set<number>; hot: string | null }) {
  if (!a.facts.length) return null;
  const href = new Map(a.citations.map((c) => [c.check_id, c.href]));
  const inFacts = new Set(a.facts.flatMap((f) => f.checks.map((c) => c.check_id)));
  const extra = a.citations.filter((c) => !inFacts.has(c.check_id));
  return (
    <section className="nx-ask-record" aria-label={t("On the record")} id={`ask-${turn}-record`}>
      <header className="nx-ask-head">
        <h3 className="nx-ask-title">{isRefused(a) ? t("On the record (the draft was withheld)") : t("On the record")}</h3>
        <span className="nx-ask-meta">{t("{n} facts", { n: a.facts.length })}</span>
      </header>
      <dl className="nx-ask-facts">
        {a.facts.map((f, i) => {
          const n = i + 1;
          return (
            <div key={n} id={rowId(turn, n)} className="nx-ask-row" data-hot={hot === rowId(turn, n) ? "1" : undefined} tabIndex={-1}>
              <span className="nx-ask-fn" data-cited={cited.has(n) ? "1" : undefined}>{`F${n}`}</span>
              <dt>{f.href ? <V2Link href={f.href}>{f.statement}</V2Link> : f.statement}</dt>
              <span className="nx-ask-val">{f.value == null ? "" : vizNum(f.value)}</span>
              <dd>
                <span>{t("Source: {source}", { source: f.source })}</span>
                {f.checks.map((c) => {
                  const h = href.get(c.check_id);
                  const label = <Mono>{c.check_id}</Mono>;
                  return h ? <V2Link key={c.check_id} href={h} className="nx-ask-chk">{label}</V2Link> : <span key={c.check_id} className="nx-ask-chk">{label}</span>;
                })}
              </dd>
            </div>
          );
        })}
      </dl>
      {extra.length ? (
        <p className="nx-ask-also">
          {t("Also cited:")}
          {extra.map((c) => <V2Link key={c.check_id} href={c.href}><Mono>{c.check_id}</Mono></V2Link>)}
        </p>
      ) : null}
    </section>
  );
}

function TurnView({ turn, hot, onPick, onRetry, busy }: { turn: Turn; hot: string | null; onPick: (turn: number, n: number) => void; onRetry: () => void; busy: boolean }) {
  const a = turn.answer;
  const facts = a?.facts ?? turn.evidence?.facts ?? [];
  const coverage = a?.coverage ?? turn.evidence?.coverage ?? 0;
  const refused = a ? isRefused(a) : turn.evidence ? !turn.evidence.grounded : false;
  const cited = a && !refused ? citeFacts(a.answer, facts).cited : new Set<number>();
  const pick = (n: number) => onPick(turn.id, n);
  const record = () => document.getElementById(`ask-${turn.id}-record`)?.scrollIntoView?.({ block: "nearest" });
  return (
    <div className="nx-ask-turn">
      <p className="nx-ask-q">{turn.question}</p>
      {turn.error ? (
        <div role="alert" className="nx-error">
          <p className="nx-error-p">{turn.error}</p>
          <Button variant="secondary" size={32} icon="refresh" disabled={busy} onClick={onRetry}>{t("Try again")}</Button>
        </div>
      ) : a ? (
        <article className="nx-ask-a" data-refused={refused ? "1" : undefined} data-testid="ask-answer">
          <FactGraphCard turn={turn.id} facts={facts} coverage={coverage} cited={cited} pending={false} refused={refused} onPick={pick} />
          {refused ? (
            <div className="nx-ask-prose">
              <Chip tone="warn">{t("Withheld")}</Chip>
              <p>{t("The numbers in the draft did not match this run's facts, so Aletheia withheld it.")}</p>
            </div>
          ) : (
            <Prose text="" answer={a} facts={facts} turn={turn.id} streaming={false} onPick={pick} />
          )}
          <VerifyChip a={a} />
          <LivingVizCard a={a} scrollToRecord={record} />
          <OnTheRecord turn={turn.id} a={a} cited={cited} hot={hot} />
          <Feedback runId={a.version_id ?? null} />
          {a.links.length ? (
            <footer className="nx-cn-acts">
              {a.links.map((l) => <V2Link key={l.href} href={l.href} className="nx-ask-next">{l.label}</V2Link>)}
            </footer>
          ) : null}
        </article>
      ) : (
        <article className="nx-ask-a" data-testid="ask-pending">
          {turn.evidence ? <FactGraphCard turn={turn.id} facts={facts} coverage={coverage} cited={cited} pending refused={false} onPick={pick} /> : <Skeleton lines={2} label={t("Reading the facts")} />}
          {turn.evidence?.grounded !== false && turn.text ? <Prose text={turn.text} facts={facts} turn={turn.id} streaming onPick={pick} /> : null}
        </article>
      )}
    </div>
  );
}

/** Ask Aletheia: the thread, the landing and the dock. Answers use only the current run's facts. */
export function AskBodyNative({ hero = true, scope, module, versionId }: { hero?: boolean; scope?: string; module?: string; versionId?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [chips, setChips] = useState<string[]>(() => SUGGESTIONS.map((s) => s()));
  const [hot, setHot] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const next = useRef(0);
  const hotTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let live = true;
    getSuggestions({ module, version_id: versionId })
      .then((s) => { if (live && s.length) setChips(s); })
      .catch(() => { /* the fixed questions stay */ });
    return () => { live = false; };
  }, [module, versionId]);

  // "/" focuses the question, unless a field already has the keys. Cmd+K belongs to the Shell palette.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);
  useEffect(() => () => clearTimeout(hotTimer.current), []);

  const patch = (id: number, p: Partial<Turn> | ((x: Turn) => Partial<Turn>)) =>
    setTurns((all) => all.map((x) => (x.id === id ? { ...x, ...(typeof p === "function" ? p(x) : p) } : x)));

  const run = async (id: number, q: string) => {
    setBusy(true);
    const body = { question: q, scope: "current" as const, ...(versionId ? { version_id: versionId } : {}), ...(module ? { module } : {}) };
    let sawEvidence = false;
    let done = false;
    try {
      try {
        await askStream(body, {
          onEvidence: (e) => { sawEvidence = true; patch(id, { evidence: e }); },
          onToken: (s) => patch(id, (x) => ({ text: x.text + s })),
          onDone: (d) => { done = true; patch(id, { answer: d }); },
        });
        if (done) return;
      } catch (e) {
        if (sawEvidence) throw e;
      }
      // The stream could not finish before evidence: the plain endpoint gives the same answer in one piece.
      patch(id, { answer: await v2Post<AskAnswer>("/assistant/ask", body) });
    } catch (e) {
      patch(id, { error: failureText(e) });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setText("");
    const id = next.current++;
    setTurns((p) => [...p, { id, question: q, text: "" }]);
    void run(id, q);
  };
  const retry = (turn: Turn) => {
    if (busy) return;
    patch(turn.id, { error: undefined, evidence: undefined, text: "", answer: undefined });
    void run(turn.id, turn.question);
  };
  const pick = (turn: number, n: number) => {
    const id = rowId(turn, n);
    document.getElementById(id)?.scrollIntoView?.({ block: "nearest" });
    document.getElementById(id)?.focus?.({ preventScroll: true });
    setHot(id);
    clearTimeout(hotTimer.current);
    hotTimer.current = setTimeout(() => setHot(null), 1200);
  };
  const seed = (q: string) => { setText(q); input.current?.focus(); };
  const submit = (e: FormEvent) => { e.preventDefault(); ask(text); };
  const landing = turns.length === 0;

  return (
    <div className="nx-ask">
      {landing ? (
        <div className="nx-ask-landing">
          {hero ? <div className="nx-ask-hero" aria-hidden="true"><Icon name="sparkles" size={28} /></div> : null}
          <p className="nx-ask-promise">{t("I only say what I can prove, and I show where every number comes from.")}</p>
          <h2 className="nx-ask-h">{t("Ask Aletheia about {scope}", { scope: scope ?? t("this run") })}</h2>
          <p className="nx-ask-sub">{t("Answers come from this run's verified facts. Never a probability, never a guess.")}</p>
        </div>
      ) : (
        <div className="nx-ask-log" aria-live="polite" aria-busy={busy}>
          {turns.map((x) => <TurnView key={x.id} turn={x} hot={hot} onPick={pick} onRetry={() => retry(x)} busy={busy} />)}
        </div>
      )}
      <form className="nx-ask-dock" onSubmit={submit}>
        {landing || hero ? (
          <div className="nx-cn-acts">
            {chips.map((s) => <Button key={s} variant="secondary" size={32} disabled={busy} onClick={() => seed(s)}>{s}</Button>)}
          </div>
        ) : null}
        <div className="nx-ask-in">
          <span className="nx-ask-field">
            <input ref={input} className="nx-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label={t("Your question")} placeholder={t("Ask about this run")} />
            <kbd className="nx-ask-kbd" aria-hidden="true">/</kbd>
          </span>
          <Button variant="primary" type="submit" disabled={busy || !text.trim()}>{t("Ask")}</Button>
        </div>
      </form>
    </div>
  );
}
