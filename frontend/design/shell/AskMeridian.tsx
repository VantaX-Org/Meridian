"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { useMutation, useQuery } from "@tanstack/react-query";
import { askMeridian, type AskAnswer, type AskFact } from "../../lib/api/assistant";
import { getVersion } from "../../lib/api/versions";
import { queryKeys } from "../../lib/query-keys";
import { runScopeLabel } from "../../lib/run-scope";
import { useLicence } from "../../hooks/use-licence";
import { Bar } from "../charts/Bar";
import { Line } from "../charts/Line";
import type { ChartPoint } from "../charts/theme";
import { Button } from "../primitives/Button";
import { IconButton } from "../primitives/IconButton";
import { Notice } from "../primitives/Notice";
import { IconArrowUp, IconClose } from "../icons";
import { MeridianMark } from "../icons/Mark";

/** Shown on an empty panel: six questions the API answers from your figures (api/services/assistant.py intents).
 * The third names the rule on screen when there is one (`askSuggestions`). */
export const ASK_SUGGESTIONS = [
  "How has the score moved?",
  "Which objects are weakest?",
  "What are the top failing rules?",
  "What is the value at risk?",
  "When will the open records be fixed?",
  "What will the score be in 30 days?",
] as const;

/** The licence menu item that turns the assistant on (cloudflare/licence-worker DEFAULT_MENU_ITEMS). */
export const ASK_LICENCE_KEY = "ask_meridian";

const MAX_QUESTION = 500;

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; answer?: AskAnswer };

/** The run the page shows: the run in the path (`/runs/<id>`, and the newer run of `/runs/<id>/vs/<b>`), else `?run=`. */
export function pageRun(pathname: string | null, run: string | null | undefined): string | undefined {
  const m = /^\/runs\/([^/]+)/.exec(pathname ?? "");
  return (m ? decodeURIComponent(m[1]) : run) || undefined;
}

/** The object the page shows: the object in the path (`/objects/<id>`), else the object picker's `?module=`. */
export function pageModule(pathname: string | null, module: string | null | undefined): string | undefined {
  const m = /^\/objects\/([^/]+)/.exec(pathname ?? "");
  return (m ? decodeURIComponent(m[1]) : module) || undefined;
}

/** The suggestions for this page: a rule on screen (`/objects/<o>/rules/<check>` or `?check=`) is asked about by its id. */
export function askSuggestions(pathname: string | null, check: string | null | undefined): readonly string[] {
  const m = /^\/objects\/[^/]+\/rules\/([^/]+)/.exec(pathname ?? "");
  const rule = m ? decodeURIComponent(m[1]) : check;
  if (!rule) return ASK_SUGGESTIONS;
  return ASK_SUGGESTIONS.map((q, i) => (i === 2 ? `How many records fail ${rule}?` : q));
}

/** Only in-app routes are followed: an answer never sends the user off the customer's own host. */
function internal(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function AnswerChart({ answer }: { answer: AskAnswer }) {
  if (!answer.chart || !answer.data?.length) return null;
  const points: ChartPoint[] = answer.data.map((d) => ({ x: d.label, y: d.value }));
  return answer.chart === "line" ? (
    <Line data={points} height={140} label="Answer chart" />
  ) : (
    <Bar data={points} height={Math.min(220, 32 + points.length * 30)} label="Answer chart" />
  );
}

/** "Based on N figures": a closed disclosure listing each figure the answer was assembled from and where it comes from. */
function AnswerFacts({ facts, onNavigate }: { facts: AskFact[]; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const n = facts.length;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Based on {n.toLocaleString()} {n === 1 ? "figure" : "figures"}
      </Button>
      {open && (
        <ol id={id} aria-label="Figures behind this answer" className="flex flex-col gap-2 px-2">
          {facts.map((f, i) => (
            <li key={`${i}-${f.statement}`} className="flex flex-col">
              <span className="m-text-body m-ink m-numeric">{f.statement}</span>
              {f.href && internal(f.href) ? (
                <Link href={f.href} onClick={onNavigate} className="m-text-meta m-ink-3 underline underline-offset-2">
                  {f.source}
                </Link>
              ) : (
                <span className="m-text-meta m-ink-3">{f.source}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AnswerBubble({ message, onNavigate }: { message: Extract<Message, { role: "assistant" }>; onNavigate: () => void }) {
  const a = message.answer;
  const links = (a?.links ?? []).filter((l) => internal(l.href));
  // An older server sends none of the grounding fields: absent means nothing to show, never a failed check.
  const refused = a?.intent === "refused";
  const unchecked = a?.grounded === false;
  const facts = refused || unchecked ? [] : (a?.facts ?? []);
  const coverage = a?.coverage ?? 1;
  return (
    <li className="flex flex-col gap-2" data-role="assistant">
      {/* Model-worded text is labelled in words, above the answer, so a reader knows before they read it. */}
      {a?.phrased && !refused && !unchecked && <span className="m-text-meta m-ink-3">Worded by the model from these figures</span>}
      <p className="m-text-body m-ink">{unchecked ? "This answer could not be checked against your figures" : message.text}</p>
      {a && !refused && !unchecked && <AnswerChart answer={a} />}
      {facts.length > 0 && coverage > 0 && coverage < 1 && <Notice tone="info" compact>Covers part of your question</Notice>}
      {facts.length > 0 && <AnswerFacts facts={facts} onNavigate={onNavigate} />}
      {links.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} onClick={onNavigate} className="m-text-meta font-medium underline-offset-2 hover:underline m-ink-accent-ink">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * "Ask Meridian": a launcher fixed bottom-right that opens a question panel. Questions go to
 * POST /api/v1/assistant/ask with the run the page shows (`?run=`); answers are assembled from the run's figures, listed
 * under each answer ("Based on N figures"). When the model rewords them the answer is labelled so; a refusal is a plain
 * sentence with its suggestions, and an answer the server could not check against the figures is never shown.
 * Escape closes the panel and focus returns to the launcher. Hidden in print and when the licence turns it off.
 */
export function AskMeridian() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const nextId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const search = useSearchParams();
  const run = pageRun(pathname, search?.get("run"));
  const objectId = pageModule(pathname, search?.get("module"));
  const version = useQuery({ queryKey: queryKeys.run(run ?? ""), queryFn: () => getVersion(run as string), enabled: !!run, retry: false, meta: { ignoreError: true } });
  // Without a run the page shows the current state: the score is read across every object at its latest run, the
  // other answers from the newest run.
  const scope = !run ? "the current state and your latest run" : version.data ? runScopeLabel(version.data) : "the run on this page";
  // Answers belong to the run they were asked about: a new run on screen starts a new thread.
  const [threadRun, setThreadRun] = useState(run);
  if (threadRun !== run) {
    setThreadRun(run);
    setMessages([]);
  }
  const { isMenuItemEnabled, manifest } = useLicence();

  const ask = useMutation({
    mutationFn: (question: string) => askMeridian({ question, version_id: run, module: objectId, scope: run ? undefined : "current" }),
    onSuccess: (answer) => push({ role: "assistant", text: answer.answer, answer }),
    onError: () => push({ role: "assistant", text: "I could not reach Meridian just now. Try again in a moment." }),
  });

  function push(m: Omit<Extract<Message, { role: "user" }>, "id"> | Omit<Extract<Message, { role: "assistant" }>, "id">) {
    const id = nextId.current++;
    setMessages((ms) => [...ms, { ...m, id } as Message]);
  }

  function send(text: string) {
    const question = text.trim().slice(0, MAX_QUESTION);
    if (!question || ask.isPending) return;
    push({ role: "user", text: question });
    setDraft("");
    ask.mutate(question);
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  // Keep the newest message in view; a jump, not a scroll animation, so reduced motion needs nothing extra.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, ask.isPending]);

  if (!isMenuItemEnabled(ASK_LICENCE_KEY) || manifest.features?.ask_meridian === false) return null;

  return (
    <div className="m-print-hide fixed bottom-4 right-4 z-40">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger ref={launcherRef} render={<Button variant="secondary" className="m-elev-2" />}>
          <MeridianMark size={16} variant="mono" />
          Ask Meridian
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="end" sideOffset={8} className="z-50">
            <Popover.Popup
              initialFocus={inputRef}
              finalFocus={launcherRef}
              aria-label="Ask Meridian"
              className="m-popup m-print-hide flex flex-col"
              style={{ width: 400, maxWidth: "calc(100vw - 32px)", height: 520, maxHeight: "calc(100vh - 96px)", padding: 0, overflow: "hidden" }}
            >
              <div className="flex shrink-0 items-start justify-between gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--m-line)" }}>
                <div className="min-w-0">
                  <Popover.Title className="m-text-h font-semibold m-ink">Ask Meridian</Popover.Title>
                  <Popover.Description className="m-text-meta m-ink-3">
                    Answers from the figures of {scope}
                  </Popover.Description>
                </div>
                <Popover.Close render={<IconButton aria-label="Close" size="sm" />}>
                  <IconClose size={16} />
                </Popover.Close>
              </div>

              <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
                {/* The log is always mounted, so a screen reader announces the first answer as it arrives. */}
                {messages.length === 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="m-text-meta m-ink-3">Try one of these</p>
                    <ul className="flex flex-col items-start gap-2">
                      {askSuggestions(pathname, search?.get("check")).map((q) => (
                        <li key={q}>
                          <Button variant="secondary" size="sm" onClick={() => send(q)}>{q}</Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <ol role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-4">
                    {messages.map((m) =>
                      m.role === "user" ? (
                        <li key={m.id} data-role="user" className="self-end m-text-body px-3 py-2" style={{ background: "var(--m-accent-soft)", color: "var(--m-ink)", borderRadius: "var(--m-radius-control)", maxWidth: "85%" }}>
                          {m.text}
                        </li>
                      ) : (
                        <AnswerBubble key={m.id} message={m} onNavigate={() => setOpen(false)} />
                      ),
                    )}
                    {ask.isPending && (
                      <li className="m-text-meta inline-flex items-center gap-2 m-ink-3" aria-busy="true">
                        <span className="m-spinner m-motion-spin" aria-hidden="true" />
                        Reading the figures
                      </li>
                    )}
                </ol>
              </div>

              <form onSubmit={onSubmit} className="flex shrink-0 items-center gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--m-line)" }}>
                {/* The Input primitive's class on a plain input: the panel needs its ref for initial focus. */}
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={MAX_QUESTION}
                  placeholder="Ask about your data quality"
                  aria-label="Your question"
                  className="m-input flex-1"
                  autoComplete="off"
                />
                <IconButton type="submit" aria-label="Send" disabled={!draft.trim() || ask.isPending}>
                  <IconArrowUp size={16} />
                </IconButton>
              </form>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
