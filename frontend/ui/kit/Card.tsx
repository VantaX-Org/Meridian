import type { ReactNode } from "react";

/** A titled surface. `action` sits at the end of the title row. */
export function Card({ title, sub, action, children, className }: { title: string; sub?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mx-card ${className ?? ""}`} aria-label={title}>
      <div className="mx-card-h">
        <div>
          <h2 className="mx-card-t">{title}</h2>
          {sub ? <p className="mx-card-s">{sub}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
