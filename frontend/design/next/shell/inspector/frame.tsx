"use client";

import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Sheet } from "../../kit";
import "./inspector.css";

export interface BodyProps {
  id: string;
  onClose: () => void;
}

/**
 * The inspector's anatomy, the same for every kind of thing: a title, a status line, then facts, actions and history.
 * It is the kit Sheet, so it traps focus, closes on Esc and gives focus back. Its id is the F6 and skip-link target.
 */
export function InspectorFrame({ title, status, onClose, children }: { title: ReactNode; status?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <aside aria-label={t("Inspector")} data-testid="inspector">
      <Sheet open onClose={onClose} title={title} size="large" id="m2-inspector" closeLabel={t("Close inspector")} focusClose>
        <div className="nx-ib">
          {status ? <div className="nx-ib-status">{status}</div> : null}
          {children}
        </div>
      </Sheet>
    </aside>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return (
    <section className="nx-ib-sec">
      <h3>{t("Facts")}</h3>
      <dl className="nx-ib-facts">{children}</dl>
    </section>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="nx-ib-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return (
    <section className="nx-ib-sec">
      <h3>{t("Actions")}</h3>
      <div className="nx-ib-acts">{children}</div>
    </section>
  );
}
