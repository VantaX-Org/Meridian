import { askStream, type AskDone, type AskEvidence, type AskScope, type AskStreamHandlers } from "@/lib/api/v2/assistant";
import { fixtureActive } from "@/lib/api/v2/fixture";
import { fixtureStream } from "./fixtureStream";

/** What the open screen knows about the thing being asked about. Only these ids ever reach the backend. */
export interface AskContext { version_id?: string; module?: string; check_id?: string; record_key?: string }

/**
 * The request body. Exactly these keys: the question and the scope ids. Row values, field contents and
 * record data are never added here; the backend builds its figures from aggregates only.
 */
export function buildBody(question: string, ctx: AskContext = {}): AskScope {
  const body: AskScope = { question, scope: "current" };
  if (ctx.version_id) body.version_id = ctx.version_id;
  if (ctx.module) body.module = ctx.module;
  if (ctx.check_id) body.check_id = ctx.check_id;
  if (ctx.record_key) body.record_key = ctx.record_key;
  return body;
}

/** Streams an answer from the backend, or from the fixture stream in fixture mode. */
export function streamAnswer(body: AskScope, h: AskStreamHandlers, signal?: AbortSignal): Promise<void> {
  return fixtureActive() ? fixtureStream(body, h) : askStream(body, h, signal);
}

export type { AskDone, AskEvidence };
