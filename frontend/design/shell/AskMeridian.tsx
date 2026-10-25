"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { useMutation } from "@tanstack/react-query";
import { askMeridian, type AskAnswer } from "../../lib/api/assistant";
import { useLicence } from "../../hooks/use-licence";
import { Bar } from "../charts/Bar";
import { Line } from "../charts/Line";
import type { ChartPoint } from "../charts/theme";
import { Button } from "../primitives/Button";
import { IconButton } from "../primitives/IconButton";
import { IconArrowUp, IconClose } from "../icons";
import { MeridianMark } from "../icons/Mark";

/** Shown on an empty panel: the four the API lists when it has no answer (api/services/assistant.py EXAMPLES) plus one process question. */
export const ASK_SUGGESTIONS = [
  "How has the score moved?",
  "Which objects are weakest?",
  "What are the top failing rules in material master?",
  "Who has the most open work?",
  "Can procure to pay run on this data?",
] as const;

/** The licence menu item that turns the assistant on (cloudflare/licence-worker DEFAULT_MENU_ITEMS). */
export const ASK_LICENCE_KEY = "ask_meridian";

const MAX_QUESTION = 500;

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; answer?: AskAnswer };

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

function AnswerBubble({ message, onNavigate }: { message: Extract<Message, { role: "assistant" }>; onNavigate: () => void }) {
  const a = message.answer;
  const links = (a?.links ?? []).filter((l) => internal(l.href));
  return (
    <li className="flex flex-col gap-2" data-role="assistant">
      {/* Model-written text is labelled in words, above the answer, so a reader knows before they read it. */}
      {a?.ai && <span className="m-text-meta m-ink-3">Written by the model from aggregated findings</span>}
      <p className="m-text-body m-ink">{message.text}</p>
      {a && <AnswerChart answer={a} />}
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
 * POST /api/v1/assistant/ask with the run the page shows (`?run=`); answers are computed from the figures, and only
 * when no built-in answer fits does the model write one from aggregated findings (labelled "Written by the model").
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
  const run = useSearchParams()?.get("run") || undefined;
  const { isMenuItemEnabled, manifest } = useLicence();

  const ask = useMutation({
    mutationFn: (question: string) => askMeridian({ question, version_id: run }),
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
                    Answers come from your run&apos;s figures, or are written by the model from them
                  </Popover.Description>
                </div>
                <Popover.Close render={<IconButton aria-label="Close" size="sm" />}>
                  <IconClose size={16} />
                </Popover.Close>
              </div>

              <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
                {messages.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="m-text-meta m-ink-3">Try one of these</p>
                    <ul className="flex flex-col items-start gap-2">
                      {ASK_SUGGESTIONS.map((q) => (
                        <li key={q}>
                          <Button variant="secondary" size="sm" onClick={() => send(q)}>{q}</Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
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
                )}
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
