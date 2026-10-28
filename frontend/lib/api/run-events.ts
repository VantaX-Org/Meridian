/**
 * GET /api/v1/events/{versionId}: the server-sent stream of one run's progress (api/routes/events.py). An `event:` name
 * (`progress`, `complete`, `error`, `cancelled`) and a JSON `data:` body per frame, a comment line every 30 seconds.
 *
 * EventSource cannot send the bearer token, so the body is read through fetch and the frames parsed here, as the job
 * stream does (lib/api/jobs.ts). The caller keeps polling as the fallback: a stream that fails or ends ends quietly.
 */

export type RunEventName = "progress" | "complete" | "error" | "cancelled" | "message";

export interface RunEvent {
  event: RunEventName;
  /** The frame's JSON body; an empty object when it is not JSON. */
  data: Record<string, unknown>;
}

/** The events that end a stream: the server closes it after one. */
export const TERMINAL_EVENTS: ReadonlySet<RunEventName> = new Set(["complete", "error", "cancelled"]);

/** One SSE frame (the text between blank lines) as an event, or null for a heartbeat comment or an empty frame. */
export function parseFrame(frame: string): RunEvent | null {
  let event: RunEventName = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim() as RunEventName;
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(data.join("\n"));
    return { event, data: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {} };
  } catch {
    return { event, data: {} };
  }
}

/** Opens the stream of a run. Returns a function that closes it. `onEnd` runs once when the stream closes or fails. */
export function streamRunEvents(versionId: string, onEvent: (e: RunEvent) => void, onEnd: (error?: unknown) => void): () => void {
  const controller = new AbortController();
  let token: string | null = null;
  try {
    token = typeof window !== "undefined" ? localStorage.getItem("mn_auth_token") : null;
  } catch {
    token = null; // storage blocked: the stream is tried without it and the poll carries on
  }
  void (async () => {
    try {
      const res = await fetch(`/api/v1/events/${encodeURIComponent(versionId)}`, {
        headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`run events: HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const e = parseFrame(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 2);
          if (e) onEvent(e);
        }
      }
      onEnd();
    } catch (err) {
      if (!controller.signal.aborted) onEnd(err);
    }
  })();
  return () => controller.abort();
}
