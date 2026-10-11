import type { ReactNode } from "react";
import { clsx } from "clsx";

export type CardTone = "default" | "critical";

export function Card({
  title, meta, actions, children, padding = "md", tone,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  padding?: "sm" | "md" | "lg";
  tone?: CardTone;
}) {
  const hasHeader = title || meta || actions;
  return (
    <section
      className={clsx("m-card", padding === "sm" && "m-card-sm", padding === "lg" && "m-card-lg")}
      style={tone === "critical" ? { borderTop: "3px solid var(--m-critical)" } : undefined}
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
