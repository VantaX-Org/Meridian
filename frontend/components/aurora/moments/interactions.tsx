/**
 * Aurora signature moments — interaction-level primitives.
 *
 * §12 moments covered:
 *   • moment 07 — RowHoverPreview (inline preview popover on hover)
 *   • moment 08 — KanbanDrop (drop-complete pulse for kanban columns)
 *   • moment 09 — ConnectionTestButton (pulse ring + status swap)
 */

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clsx } from "../primitives/internal";
import { Button, Text } from "../primitives";

/* ------------------------------------------------------- RowHoverPreview --- */

export interface RowHoverPreviewProps {
  /** Anchor — the row. Hover + Tab focus both trigger the preview. */
  children: ReactNode;
  /** Preview body — rendered in a small popover to the right. */
  preview: ReactNode;
  /** Delay before showing, ms. Default 200. */
  delay?: number;
  className?: string;
}

export function RowHoverPreview({
  children,
  preview,
  delay = 200,
  className,
}: RowHoverPreviewProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clear();
    timerRef.current = window.setTimeout(() => setVisible(true), delay);
  }, [clear, delay]);

  const hide = useCallback(() => {
    clear();
    setVisible(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return (
    <span
      className={clsx("aurora-row-hover", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible ? (
        <span className="aurora-row-hover__preview" role="tooltip">
          {preview}
        </span>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------ KanbanDrop --- */

export interface KanbanDropProps {
  /** Column header / label. */
  title: ReactNode;
  /** Children cards. */
  children?: ReactNode;
  /** Accept a card? Host drives this via drag-over validation. */
  canAccept?: boolean;
  /** Called when a card is dropped. Host parses dataTransfer. */
  onDrop?: (event: React.DragEvent<HTMLElement>) => void;
  className?: string;
}

export function KanbanDrop({
  title,
  children,
  canAccept,
  onDrop,
  className,
}: KanbanDropProps) {
  const [over, setOver] = useState(false);
  const [pulse, setPulse] = useState(false);

  return (
    <section
      className={clsx("aurora-kanban-drop", className)}
      data-over={over && canAccept ? "true" : undefined}
      data-reject={over && canAccept === false ? "true" : undefined}
      data-pulse={pulse ? "true" : undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = canAccept === false ? "none" : "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (canAccept === false) return;
        setPulse(true);
        window.setTimeout(() => setPulse(false), 320);
        onDrop?.(event);
      }}
    >
      <header className="aurora-kanban-drop__header">
        <Text variant="text-micro" tone="tertiary">
          {title}
        </Text>
      </header>
      <div className="aurora-kanban-drop__body">{children}</div>
    </section>
  );
}

/* ------------------------------------------------- ConnectionTestButton --- */

export type ConnectionTestState = "idle" | "testing" | "success" | "error";

export interface ConnectionTestButtonProps {
  state: ConnectionTestState;
  /** Click handler. Host flips `state` → "testing" then resolves. */
  onTest: () => void;
  /** Accessible idle label. Default "Test connection". */
  idleLabel?: string;
  className?: string;
}

export function ConnectionTestButton({
  state,
  onTest,
  idleLabel = "Test connection",
  className,
}: ConnectionTestButtonProps) {
  return (
    <span className={clsx("aurora-connection-test", className)} data-state={state}>
      <Button
        size="sm"
        variant={state === "error" ? "danger" : "secondary"}
        onClick={onTest}
        disabled={state === "testing"}
        leadingIcon={<StateGlyph state={state} />}
      >
        {state === "testing"
          ? "Testing…"
          : state === "success"
            ? "Connection OK"
            : state === "error"
              ? "Connection failed"
              : idleLabel}
      </Button>
      {state === "success" ? (
        <span className="aurora-connection-test__pulse" aria-hidden />
      ) : null}
    </span>
  );
}

function StateGlyph({ state }: { state: ConnectionTestState }) {
  if (state === "testing") {
    return <span className="aurora-connection-test__spinner" aria-hidden />;
  }
  if (state === "success") {
    return (
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8l3.5 3.5L13 5" />
      </svg>
    );
  }
  if (state === "error") {
    return (
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10c2-4 8-4 10 0" />
      <path d="M6 12l2 2 2-2" />
    </svg>
  );
}
