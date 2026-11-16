import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/** A label around its control, with an optional hint and an error (announced). Pass an Input, Select or Toggle as children. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="mx-field">
      <span className="mx-field-l">{label}</span>
      {children}
      {error ? <span className="mx-field-e" role="alert">{error}</span> : hint ? <span className="mx-muted">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="mx-input" />;
}

export function Select({ options, ...rest }: { options: { value: string; label: string }[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className="mx-input">{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}

/** An on/off switch with its label. */
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mx-toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
