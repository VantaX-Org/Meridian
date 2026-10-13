import type { ReactNode } from "react";
import { Button } from "./Button";

const TITLE = "Could not reach the server.";
const norm = (t: string) => t.trim().replace(/\.$/, "").toLowerCase();

/**
 * Same card as EmptyState with a critical top bar. `message` is the server detail, shown mono.
 * `title` replaces the default network sentence (page-level errors); `detail` is a line of
 * supporting copy under it; `actions` replaces the single Retry button.
 */
export function ErrorState({
  message,
  onRetry,
  title = TITLE,
  detail,
  actions,
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      data-state="error"
      role="alert"
      className="m-elev-1 flex flex-col gap-2 text-left"
      style={{ maxWidth: 560, background: "var(--m-sheet)", borderRadius: "var(--m-radius-sheet)", borderTop: "3px solid var(--m-critical)", padding: "var(--m-space-6)" }}
    >
      <p className="text-[15px] leading-5 font-semibold" style={{ color: "var(--m-ink)" }}>{title}</p>
      {detail && <div className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{detail}</div>}
      {message && norm(message) !== norm(title) && <p className="m-mono text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{message}</p>}
      {actions ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div>
      ) : onRetry ? (
        <div className="mt-2">
          <Button variant="secondary" onClick={onRetry}>Retry</Button>
        </div>
      ) : null}
    </div>
  );
}
