/**
 * Aurora signature moment — Ask Streaming Card (§12 moment 06).
 *
 * The card that renders a user question + a streaming LLM response. The
 * spec insists on three contracts:
 *   1. Tokens appear with no skeleton / loader — the answer TEXT is the
 *      progress indicator.
 *   2. Any cited finding / record renders as an inline chip that deep-
 *      links to the record drawer (routed by the host).
 *   3. A one-line "grounded in" strip at the bottom lists the sources the
 *      answer was reduced from, so the user can audit.
 *
 * This component is presentational; consumers drive `status`, push
 * `streamingText`, and supply `citations`.
 */

"use client";

import type { ReactNode } from "react";
import { clsx } from "../primitives/internal";
import { Chip, Stack, Text } from "../primitives";

export type AskStatus = "idle" | "streaming" | "done" | "error";

export interface AskCitation {
  id: string;
  label: ReactNode;
  /** Optional tooltip / secondary text. */
  kind?: ReactNode;
  onOpen?: () => void;
}

export interface AskStreamingCardProps {
  question: ReactNode;
  /** The current answer. Streamed by the host; we render as-is. */
  answer: ReactNode;
  status: AskStatus;
  /** Records / findings the answer was grounded in. */
  citations?: ReadonlyArray<AskCitation>;
  /** Error message when status === "error". */
  error?: ReactNode;
  className?: string;
}

export function AskStreamingCard({
  question,
  answer,
  status,
  citations,
  error,
  className,
}: AskStreamingCardProps) {
  return (
    <section
      className={clsx("aurora-ask-card", className)}
      data-status={status}
      aria-live={status === "streaming" ? "polite" : "off"}
    >
      <Stack direction="column" gap={1} className="aurora-ask-card__question">
        <Text variant="text-micro" tone="tertiary">
          Ask
        </Text>
        <Text variant="text-lead">{question}</Text>
      </Stack>

      <div className="aurora-ask-card__answer">
        {status === "error" ? (
          <Text variant="text-body" tone="danger">
            {error ?? "Something went wrong — please try again."}
          </Text>
        ) : (
          <>
            <Text variant="text-body">{answer}</Text>
            {status === "streaming" ? (
              <span className="aurora-ask-card__caret" aria-hidden />
            ) : null}
          </>
        )}
      </div>

      {citations && citations.length > 0 ? (
        <div className="aurora-ask-card__citations">
          <Text variant="text-micro" tone="tertiary">
            Grounded in
          </Text>
          <Stack direction="row" gap={2} className="aurora-ask-card__chips">
            {citations.map((c) => (
              <Chip
                key={c.id}
                onClick={c.onOpen}
                title={typeof c.kind === "string" ? c.kind : undefined}
              >
                {c.label}
              </Chip>
            ))}
          </Stack>
        </div>
      ) : null}
    </section>
  );
}
