import type { ReactNode } from "react";
import { clsx } from "clsx";
import type { DomainKey } from "../tokens";

export type CardTone = "default" | "critical";

export function Card({
  title, meta, actions, children, padding = "md", tone, domain, lift = false, dataTour,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  padding?: "sm" | "md" | "lg";
  tone?: CardTone;
  /** 4px left edge in the domain solid, drawn inset so the card does not change size. */
  domain?: DomainKey;
  /** Hover lift for cards that are links or open something. */
  lift?: boolean;
  /** `data-tour` value, so a guided tour can spotlight this card (lib/help/tours.ts). */
  dataTour?: string;
}) {
  const hasHeader = title || meta || actions;
  return (
    <section
      className={clsx("m-card", lift && "m-lift", padding === "sm" && "m-card-sm", padding === "lg" && "m-card-lg")}
      data-domain={domain}
      data-tour={dataTour}
      style={{
        ...(tone === "critical" ? { borderTop: "3px solid var(--m-critical)" } : null),
        ...(domain ? { boxShadow: `inset 4px 0 0 var(--m-dom-${domain}), var(--m-elev-1)` } : null),
      }}
    >
      {hasHeader && (
        <header className="flex items-center gap-3 mb-3">
          {title && <h2 className="flex-1 text-[15px] leading-5 font-semibold" style={{ color: "var(--m-ink)" }}>{title}</h2>}
          {meta && <span className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{meta}</span>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
