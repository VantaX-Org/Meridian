import { cloneElement, type ButtonHTMLAttributes, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded px-3 py-1.5 text-[13px] leading-[18px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:cursor-not-allowed",
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

type RenderProps = { className?: string; style?: CSSProperties; children?: ReactNode };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & {
    /** Render the button as this element instead of a <button>, e.g. a Link — avoids nesting a button inside an anchor. */
    render?: ReactElement<RenderProps>;
  };

export function Button({ className, variant, style, render, children, ...props }: ButtonProps) {
  const variantStyle =
    variant === "secondary"
      ? { borderColor: "var(--m-line)", color: "var(--m-ink)", background: "var(--m-sheet)" }
      : variant === "ghost"
        ? { color: "var(--m-ink)", background: "transparent" }
        : { background: "var(--m-accent)", color: "var(--m-sheet)" };
  const classes = clsx(button({ variant }), className);
  const mergedStyle = { ...variantStyle, ...style };
  if (render) {
    return cloneElement(render, {
      className: clsx(classes, render.props.className),
      style: { ...mergedStyle, ...render.props.style },
      children: render.props.children ?? children,
    });
  }
  return (
    <button className={classes} style={mergedStyle} {...props}>
      {children}
    </button>
  );
}
