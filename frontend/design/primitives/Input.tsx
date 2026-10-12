import type { InputHTMLAttributes } from "react";

/** Text input with the design tokens applied. Wrap in `Field` for a visible label. */
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={className ? `m-input ${className}` : "m-input"} />;
}
