import { explainJobError } from "@/lib/job-error";

/**
 * A failed job's reason in plain words with the next step, and the worker's own text behind a
 * "Technical detail" disclosure. `compact` drops the next step (a table cell keeps one line plus the disclosure).
 */
export function JobError({ error, compact = false, className }: { error: string | null | undefined; compact?: boolean; className?: string }) {
  const e = explainJobError(error);
  if (!e) return null;
  return (
    <div className={className ?? "flex flex-col gap-0.5"}>
      <span className="m-text-body">{e.summary}</span>
      {compact ? null : <span className="m-text-meta m-ink-2">{e.next}</span>}
      <details className="m-text-meta m-ink-3">
        <summary className="cursor-pointer m-ink-accent">Technical detail</summary>
        <p className="mt-1 break-words">{e.detail}</p>
      </details>
    </div>
  );
}
