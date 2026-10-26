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
  /** 2px left rule in the domain solid, drawn inset so the card does not change size. */
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
        ...(tone === "critical" ? { borderTopWidth: 2, borderTopColor: "var(--m-critical)" } : null),
        ...(domain ? { boxShadow: `inset 2px 0 0 var(--m-dom-${domain})` } : null),
      }}
    >
      {hasHeader && (
        <header className="flex items-center gap-3 mb-4 max-sm:flex-wrap">
          {title && <h2 className="m-text-h flex-1 font-semibold" style={{ color: "var(--m-ink)" }}>{title}</h2>}
          {meta && <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{meta}</span>}
          {/* Below 640px the actions take their own row under the title instead of squeezing it into a column. */}
          {actions && <div data-card-actions className="contents max-sm:flex max-sm:basis-full max-sm:flex-wrap max-sm:items-center max-sm:gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
