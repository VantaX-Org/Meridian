"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatMessage } from "./AletheiaSheet";

/** What an answer carries: text, the facts it rests on, and action chips. */
export type AletheiaAnswer = Pick<ChatMessage, "text" | "evidence" | "actions">;

/**
 * What the open screen tells the one chat. `answer` is the adapter seam: fixture mode and the offline
 * path derive answers locally; the live path maps askStream (evidence, token, done) and getSuggestions
 * from lib/api/v2/assistant.ts onto the same shape without touching the sheet or the shell.
 */
export interface AletheiaScope {
  key: string;
  /** Scope line under the title, for example "Asking about Material master". */
  label: string;
  suggestions: string[];
  answer: (prompt: string) => AletheiaAnswer | Promise<AletheiaAnswer>;
}

interface Api {
  open: boolean;
  setOpen: (open: boolean) => void;
  scope: AletheiaScope | null;
  thread: ChatMessage[];
  ask: (prompt: string) => void;
  register: (scope: AletheiaScope) => () => void;
}

const NONE: ChatMessage[] = [];
const Ctx = createContext<Api | null>(null);

/** Holds the single Aletheia chat for the app: open state, the screen's scope, and one thread per scope. */
export function AletheiaProvider({ children, initialOpen = false }: { children: ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [scope, setScope] = useState<AletheiaScope | null>(null);
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const scopeRef = useRef<AletheiaScope | null>(null);
  useEffect(() => { scopeRef.current = scope; }, [scope]);

  const register = useCallback((s: AletheiaScope) => {
    setScope(s);
    return () => setScope((cur) => (cur?.key === s.key ? null : cur));
  }, []);

  const ask = useCallback((prompt: string) => {
    const s = scopeRef.current;
    if (!s) return;
    const push = (m: Omit<ChatMessage, "id">) => setThreads((cur) => {
      const list = cur[s.key] ?? [];
      return { ...cur, [s.key]: [...list, { ...m, id: `${m.role === "user" ? "u" : "a"}${list.length}` }] };
    });
    push({ role: "user", text: prompt });
    Promise.resolve(s.answer(prompt)).then((a) => push({ role: "aletheia", ...a }));
  }, []);

  const api = useMemo(() => ({ open, setOpen, scope, thread: scope ? threads[scope.key] ?? NONE : NONE, ask, register }), [open, scope, threads, ask, register]);
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
  useEffect(() => { answer.current = scope.answer; });
  const { key, label } = scope;
  const suggestions = scope.suggestions.join("\n");
  useEffect(
    () => register({ key, label, suggestions: suggestions ? suggestions.split("\n") : [], answer: (p) => answer.current(p) }),
    [register, key, label, suggestions],
  );
}
