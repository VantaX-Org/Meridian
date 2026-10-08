import type { ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";

export function IconButton({ className, "aria-label": label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return (
    <button
      aria-label={label}
      className={clsx("inline-flex items-center justify-center rounded w-8 h-8", className)}
      style={{ color: "var(--m-ink-2)" }}
      {...props}
    />
  );
}
