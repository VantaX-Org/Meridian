/**
 * Ask Meridian chat client (api/routes/assistant.py): the streaming answer and the suggested questions.
 * The thread is kept in memory by the caller; the API stores none.
 */
import { v2Get } from "./client";

export interface AskScope {
  question: string;
  version_id?: string;
  module?: string;
  scope?: "current";
  /** narrow the question to one rule check */
  check_id?: string;
  /** narrow the question to one failing record; the key never reaches the model */
  record_key?: string;
}

export interface AskFact { statement: string; value?: number | null; source: string; href?: string | null; checks: { check_id: string; module?: string | null }[] }
export interface AskCitation { check_id: string; module?: string | null; href: string }

/** First event: the figures the answer rests on. */
export interface AskEvidence {
  intent: string;
  version_id: string | null;
  facts: AskFact[];
  citations: AskCitation[];
  data: { label: string; value: number; role?: "naive" | "true" }[] | null;
  pace_pct?: number;
  signals?: number;
  sampling?: "none" | "sampled";
  value_found?: number;
  chart: "bar" | "line" | null;
  links: { label: string; href: string }[];
  coverage: number;
  grounded: boolean;
}

/** Last event: the whole AskAnswer. */
export interface AskDone extends AskEvidence { answer: string; ai: boolean; phrased: boolean }

export interface AskStreamHandlers {
  onEvidence: (e: AskEvidence) => void;
  onToken: (text: string) => void;
  onDone: (a: AskDone) => void;
}

/** POST /assistant/ask/stream: events `evidence`, then `token` (answer text in chunks), then `done`. Rejects on a non-2xx. */
export async function askStream(body: AskScope, h: AskStreamHandlers, signal?: AbortSignal): Promise<void> {
  const csrf = document.cookie.split("; ").find((c) => c.startsWith("mn_csrf="));
  const res = await fetch("/api/v1/assistant/ask/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(csrf ? { "X-CSRF-Token": decodeURIComponent(csrf.slice("mn_csrf=".length)) } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`assistant stream: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = frame.split("\n");
      const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
      const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!event || !data) continue;
      try {
        const parsed: unknown = JSON.parse(data);
        if (event === "evidence") h.onEvidence(parsed as AskEvidence);
        else if (event === "token") h.onToken((parsed as { text: string }).text);
        else if (event === "done") h.onDone(parsed as AskDone);
      } catch {
        /* malformed frame: skip */
      }
    }
  }
}

/** GET /assistant/suggestions: 3 to 6 questions built from the scope's top findings, no model. */
export async function getSuggestions(scope: { module?: string; version_id?: string; check_id?: string } = {}): Promise<string[]> {
  const out = await v2Get<{ suggestions: string[] }>("/assistant/suggestions", scope);
  return out.suggestions;
}
