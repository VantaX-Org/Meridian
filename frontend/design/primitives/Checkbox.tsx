import type { InputHTMLAttributes } from "react";

/** Native checkbox with the design tokens applied. `aria-label` is required: there is no visible label. */
export function Checkbox(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & { "aria-label": string }) {
  return <input {...props} type="checkbox" className="m-checkbox" />;
}
