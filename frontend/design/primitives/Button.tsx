import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded px-3 py-1.5 text-[13px] leading-[18px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "",
        secondary: "border",
        ghost: "",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>;

export function Button({ className, variant, style, ...props }: ButtonProps) {
  const variantStyle =
    variant === "secondary"
      ? { borderColor: "var(--m-line)", color: "var(--m-ink)", background: "var(--m-sheet)" }
      : variant === "ghost"
        ? { color: "var(--m-ink)", background: "transparent" }
        : { background: "var(--m-accent)", color: "var(--m-sheet)" };
  return <button className={clsx(button({ variant }), className)} style={{ ...variantStyle, ...style }} {...props} />;
}
