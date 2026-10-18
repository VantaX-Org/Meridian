import type { ReactNode } from "react";

export type NoticeTone = "info" | "warning" | "danger" | "success";

const TONE: Record<NoticeTone, { bar: string; bg: string; ink: string }> = {
  info: { bar: "var(--m-info)", bg: "var(--m-info-soft)", ink: "var(--m-info-ink)" },
  warning: { bar: "var(--m-at-risk)", bg: "var(--m-at-risk-soft)", ink: "var(--m-at-risk-ink)" },
  danger: { bar: "var(--m-critical)", bg: "var(--m-critical-soft)", ink: "var(--m-critical-ink)" },
  success: { bar: "var(--m-pass)", bg: "var(--m-pass-soft)", ink: "var(--m-pass-ink)" },
};

/** Tinted note with a 3px tone bar; replaces the legacy Banner. `action` sits on the right. */
export function Notice({ tone = "info", title, children, action }: {
  tone?: NoticeTone; title?: ReactNode; children?: ReactNode; action?: ReactNode;
}) {
  const t = TONE[tone];
  const urgent = tone === "danger" || tone === "warning";
  return (
    <div
      className="flex items-start justify-between gap-3 px-3 py-2 m-text-body"
      style={{ background: t.bg, borderLeft: `3px solid ${t.bar}`, color: t.ink, borderRadius: "var(--m-radius-control)" }}
      role={urgent ? "alert" : "status"}
    >
      <div>
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
      </div>
      {action ? <span className="flex shrink-0 gap-2">{action}</span> : null}
    </div>
  );
}
