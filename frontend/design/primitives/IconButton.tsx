import type { ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";

export function IconButton({
  className, "aria-label": label, size, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string; size?: "sm" | "md" }) {
  return (
    <button
      aria-label={label}
      className={clsx("m-iconbtn m-motion-colors", size === "sm" && "m-iconbtn-sm", className)}
      {...props}
    />
  );
}
