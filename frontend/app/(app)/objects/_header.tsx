import type { ReactNode } from "react";

/** Page header until `design/primitives/PageHeader` lands: title (h2 until PageHeader renders the page h1), one meta line, status and actions. */
export function ObjectsHeader({ title, meta, status, actions }: { title: ReactNode; meta?: ReactNode; status?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-3">
          <h2 style={{ fontSize: "var(--m-text-title)", lineHeight: "var(--m-leading-title)", fontWeight: 600, color: "var(--m-ink)" }}>{title}</h2>
          {status}
        </div>
        {meta ? <p style={{ fontSize: "var(--m-text-body)", lineHeight: "var(--m-leading-body)", color: "var(--m-ink-2)" }}>{meta}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Removable-style filter chips: one pressed button per option. */
export function FilterChips<T extends string>({ label, value, options, onChange }: {
  label: string; value: T | null; options: { value: T; label: string }[]; onChange: (next: T | null) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span style={{ fontSize: "var(--m-text-meta)", color: "var(--m-ink-3)" }}>{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`m-btn m-btn-sm ${value === o.value ? "m-btn-secondary" : "m-btn-ghost"}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(value === o.value ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
