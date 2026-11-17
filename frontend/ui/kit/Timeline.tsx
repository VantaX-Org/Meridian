import type { ReactNode } from "react";

export interface TimelineEvent { id: string; /** Already formatted. */ at: string; title: ReactNode; note?: ReactNode }

/** Dated events in the order given. */
export function Timeline({ events, label }: { events: TimelineEvent[]; label: string }) {
  return (
    <ol className="mx-timeline" aria-label={label}>
      {events.map((e) => (
        <li key={e.id}><time className="mx-muted mx-num">{e.at}</time><span>{e.title}</span>{e.note ? <span className="mx-muted">{e.note}</span> : null}</li>
      ))}
    </ol>
  );
}
