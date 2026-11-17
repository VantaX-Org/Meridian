"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AskDone, AskEvidence } from "@/lib/api/v2/assistant";
import { t } from "@/lib/v2/i18n";
import type { ChatFact, ChatMessage } from "./AletheiaSheet";
import { buildBody, streamAnswer, type AskContext } from "./aletheia/stream";

/** What an answer carries: text, the facts it rests on, and action chips. */
export type AletheiaAnswer = Pick<ChatMessage, "text" | "evidence" | "actions">;

/**
 * What the open screen tells the one chat. Two ways to answer:
 * - `context` (module, run, rule, record ids): the chat streams from the backend, or from the fixture stream in fixture mode.
 * - `answer`: the screen answers locally from data it already holds (the object screen does this).
 */
export interface AletheiaScope {
  key: string;
  /** Scope line under the title, for example "Asking about Material master". */
  label: string;
  /** Static prompts: shown first and kept as the fallback when the live ones cannot load. */
  suggestions: string[];
  context?: AskContext;
  answer?: (prompt: string) => AletheiaAnswer | Promise<AletheiaAnswer>;
}

interface Api {
  open: boolean;
  setOpen: (open: boolean) => void;
  scope: AletheiaScope | null;
  thread: ChatMessage[];
  ask: (prompt: string) => void;
  register: (scope: AletheiaScope) => () => void;
  /** Drop the rule and record narrowing, keeping the module and run. */
  clearContext: () => void;
}

const NONE: ChatMessage[] = [];
const Ctx = createContext<Api | null>(null);

const factsOf = (e: AskEvidence): ChatFact[] => e.facts.map((f) => ({ statement: f.statement, value: f.value, href: f.href, checks: f.checks }));
const evidenceFields = (e: AskEvidence): Partial<ChatMessage> => ({
  facts: factsOf(e),
  chart: e.chart && e.data?.length ? { kind: e.chart, data: e.data } : undefined,
  links: e.links,
  footer: { n: e.facts.length, coverage: e.coverage, phrased: false },
});

/** Holds the single Aletheia chat for the app: open state, the screen's scope, and one thread per scope. */
export function AletheiaProvider({ children, initialOpen = false }: { children: ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [scope, setScope] = useState<AletheiaScope | null>(null);
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const scopeRef = useRef<AletheiaScope | null>(null);
  const seq = useRef(0);
  useEffect(() => { scopeRef.current = scope; }, [scope]);

  const register = useCallback((s: AletheiaScope) => {
    setScope(s);
    return () => setScope((cur) => (cur?.key === s.key ? null : cur));
  }, []);

  const clearContext = useCallback(() => setScope((cur) => (cur?.context ? { ...cur, context: { version_id: cur.context.version_id, module: cur.context.module } } : cur)), []);

  const ask = useCallback((prompt: string) => {
    const s = scopeRef.current;
    if (!s) return;
    const n = seq.current++;
    const patch = (id: string, p: (m: ChatMessage) => Partial<ChatMessage>) => setThreads((cur) => ({
      ...cur,
      [s.key]: (cur[s.key] ?? []).map((m) => (m.id === id ? { ...m, ...p(m) } : m)),
    }));
    const push = (m: ChatMessage) => setThreads((cur) => ({ ...cur, [s.key]: [...(cur[s.key] ?? []), m] }));
    push({ id: `u${n}`, role: "user", text: prompt });
    if (s.answer) {
      Promise.resolve(s.answer(prompt)).then((a) => push({ id: `a${n}`, role: "aletheia", ...a }));
      return;
    }
    const id = `a${n}`;
    push({ id, role: "aletheia", text: "", pending: true });
    streamAnswer(buildBody(prompt, s.context), {
      onEvidence: (e) => patch(id, () => evidenceFields(e)),
      onToken: (tok) => patch(id, (m) => ({ text: m.text + tok })),
      onDone: (d: AskDone) => patch(id, () => ({ ...evidenceFields(d), text: d.answer, pending: false, footer: { n: d.facts.length, coverage: d.coverage, phrased: d.phrased } })),
    }).catch(() => patch(id, () => ({ text: t("Aletheia could not answer just now. Try again in a moment."), pending: false })));
  }, []);

  const api = useMemo(() => ({ open, setOpen, scope, thread: scope ? threads[scope.key] ?? NONE : NONE, ask, register, clearContext }), [open, scope, threads, ask, register, clearContext]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAletheia(): Api {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAletheia needs an AletheiaProvider above it"); // i18n-ignore
  return c;
}

/** A screen calls this once to scope the shared chat to itself; the scope clears when the screen unmounts. */
export function useAletheiaScope(scope: AletheiaScope): void {
  const { register } = useAletheia();
  const answer = useRef(scope.answer);
  const hasAnswer = !!scope.answer;
  useEffect(() => { answer.current = scope.answer; });
  const { key, label } = scope;
  const suggestions = scope.suggestions.join("\n");
  const context = scope.context ? JSON.stringify(scope.context) : "";
  useEffect(
    () => register({
      key,
      label,
      suggestions: suggestions ? suggestions.split("\n") : [],
      context: context ? (JSON.parse(context) as AskContext) : undefined,
      answer: hasAnswer ? (p) => answer.current!(p) : undefined,
    }),
    [register, key, label, suggestions, context, hasAnswer],
  );
}
