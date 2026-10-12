"use client";

/**
 * Page-local building blocks for the rules pages. Swap points once the shared
 * foundations land: RulesHeader -> `PageHeader`, RuleSwitch -> `Switch`,
 * TextInput / TextArea -> `Input`.
 */

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Mono } from "@/design";
import { checkClassLabel } from "@/lib/format";

const CONTROL: React.CSSProperties = {
  borderRadius: "var(--m-radius-control)",
  border: "1px solid var(--m-line-strong)",
  background: "var(--m-sheet)",
  color: "var(--m-ink)",
};

export const TextInput = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<"input">>(function TextInput({ style, className, ...p }, ref) {
  return <input ref={ref} className={`m-text-body m-motion-colors w-full px-3 ${className ?? ""}`} style={{ ...CONTROL, height: 32, ...style }} {...p} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(function TextArea({ style, className, ...p }, ref) {
  return <textarea ref={ref} className={`m-text-body m-motion-colors w-full px-3 py-2 ${className ?? ""}`} style={{ ...CONTROL, ...style }} {...p} />;
});

/** Page title, one meta line, status and actions on the right. */
export function RulesHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 pb-2">
      <div className="min-w-0">
        <h1 className="m-text-title font-semibold" style={{ color: "var(--m-ink)" }}>{title}</h1>
        {meta != null ? <p className="m-text-body" style={{ color: "var(--m-ink-2)", minHeight: 18 }}>{meta}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Accessible on/off switch; the caller owns the (optimistic) state. */
export function RuleSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className="m-motion-colors relative inline-flex shrink-0 items-center"
      style={{ width: 28, height: 16, borderRadius: 8, background: checked ? "var(--m-accent)" : "var(--m-line-strong)", opacity: disabled ? 0.5 : 1 }}
    >
      <span
        aria-hidden
        className="m-motion-colors absolute"
        style={{ top: 2, left: checked ? 14 : 2, width: 12, height: 12, borderRadius: 6, background: "var(--m-sheet)" }}
      />
    </button>
  );
}

export type FilterChip = { key: string; label: string; clear: () => void };

/** Removable chips for every active filter, with one "Clear all". */
export function FilterChips({ chips, onClearAll }: { chips: FilterChip[]; onClearAll: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          aria-label={`Remove filter ${c.label}`}
          className="m-text-meta m-motion-colors inline-flex items-center gap-1 px-2"
          style={{ height: 24, borderRadius: "var(--m-radius-control)", background: "var(--m-accent-soft)", color: "var(--m-ink)" }}
        >
          {c.label}<X size={12} aria-hidden />
        </button>
      ))}
      <button type="button" onClick={onClearAll} className="m-text-meta px-1" style={{ color: "var(--m-accent)" }}>Clear all</button>
    </div>
  );
}

/** Label / value rows for drawers and cards. */
export function Rows({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="m-text-body flex flex-col gap-1">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <dt style={{ color: "var(--m-ink-3)" }}>{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const scalar = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(scalar).join(", ") : typeof v === "object" && v !== null ? Object.entries(v).map(([k, x]) => `${k}=${scalar(x)}`).join(", ") : String(v));

/** A condition as prose ("Null check on LFA1.STCD1") plus its remaining parameters as key = value lines. */
export function ConditionList({ conditions }: { conditions: Record<string, unknown>[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {conditions.map((c, i) => {
        const { check_class: cls, field, ...rest } = c;
        const params = Object.entries(rest).filter(([, v]) => v != null && v !== "");
        return (
          <li key={i} className="m-text-body flex flex-col gap-1">
            <span>
              {typeof cls === "string" ? checkClassLabel(cls) : "Condition"}
              {typeof field === "string" ? <> on <Mono>{field}</Mono></> : null}
            </span>
            {params.length ? (
              <pre className="m-text-meta overflow-auto p-2" style={{ fontFamily: "var(--m-font-mono)", background: "var(--m-sheet-raised)", borderRadius: "var(--m-radius-control)" }}>
                {params.map(([k, v]) => `${k} = ${scalar(v)}`).join("\n")}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Threshold object as a two-column table. */
export function ThresholdTable({ thresholds }: { thresholds: object }) {
  const rows = Object.entries(thresholds);
  return (
    <table className="m-text-body w-full">
      <thead>
        <tr className="m-text-label text-left" style={{ color: "var(--m-ink-3)" }}><th className="py-1 font-medium">Threshold</th><th className="py-1 font-medium">Value</th></tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} style={{ borderTop: "1px solid var(--m-line)" }}>
            <td className="py-1">{k.replace(/_/g, " ")}</td>
            <td className="py-1"><Mono>{scalar(v)}</Mono></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
