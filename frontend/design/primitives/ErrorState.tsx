import { Button } from "./Button";

const TITLE = "Could not reach the server.";
const norm = (t: string) => t.trim().replace(/\.$/, "").toLowerCase();

/** Same card as EmptyState with a critical top bar. `message` is the server detail, shown mono. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      data-state="error"
      role="alert"
      className="m-elev-1 flex flex-col gap-2 text-left"
      style={{ maxWidth: 560, background: "var(--m-sheet)", borderRadius: "var(--m-radius-sheet)", borderTop: "3px solid var(--m-critical)", padding: "var(--m-space-6)" }}
    >
      <p className="text-[15px] leading-5 font-semibold" style={{ color: "var(--m-ink)" }}>{TITLE}</p>
      {norm(message) !== norm(TITLE) && <p className="m-mono text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{message}</p>}
      {onRetry && (
        <div className="mt-2">
          <Button variant="secondary" onClick={onRetry}>Retry</Button>
        </div>
      )}
    </div>
  );
}
