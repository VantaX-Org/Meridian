import type { ReactNode } from "react";

/** Page title, one line of run context, and a pill button row (`actions`). */
export function PageHeader({ title, context, actions }: { title: string; context?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mx-head">
      <div className="mx-head-t">
        <h1 className="mx-h1">{title}</h1>
        {context ? <p className="mx-muted">{context}</p> : null}
      </div>
      {actions ? <div className="mx-head-actions">{actions}</div> : null}
    </header>
  );
}
