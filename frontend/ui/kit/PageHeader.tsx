import Link from "next/link";
import type { ReactNode } from "react";

/** Page title, one line of run context, and a pill button row (`actions`). `back` links to the parent screen above the title. */
export function PageHeader({ title, context, actions, back }: { title: string; context?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mx-head">
      <div className="mx-head-t">
        {back ? <Link href={back.href} className="mx-back">{back.label}</Link> : null}
        <h1 className="mx-h1">{title}</h1>
        {context ? <p className="mx-muted">{context}</p> : null}
      </div>
      {actions ? <div className="mx-head-actions">{actions}</div> : null}
    </header>
  );
}
