import { cloneElement, type ButtonHTMLAttributes, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

const button = cva("m-btn m-motion-colors aria-disabled:opacity-50 aria-disabled:cursor-not-allowed", {
  variants: {
    variant: { primary: "m-btn-primary", secondary: "m-btn-secondary", ghost: "m-btn-ghost", danger: "m-btn-danger" },
    size: { sm: "m-btn-sm", md: "", lg: "m-btn-lg" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});

type RenderProps = { className?: string; style?: CSSProperties; children?: ReactNode };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & {
    /** Render the button as this element instead of a <button>, e.g. a Link — avoids nesting a button inside an anchor. */
    render?: ReactElement<RenderProps>;
    /** Replaces the leading icon with a spinner and disables the button. */
    pending?: boolean;
  };

export function Button({ className, variant, size, style, render, pending, children, disabled, ...props }: ButtonProps) {
  const classes = clsx(button({ variant, size }), className);
  const content = (
    <>
      {pending && <span className="m-spinner m-motion-spin" aria-hidden="true" />}
      {children}
    </>
  );
  if (render) {
    return cloneElement(render, {
      className: clsx(classes, render.props.className),
      style: { ...style, ...render.props.style },
      children: render.props.children ?? content,
      ...(pending ? { "aria-busy": true, "aria-disabled": true } : {}),
    } as Partial<RenderProps>);
  }
  return (
    <button className={classes} style={style} disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {content}
    </button>
  );
}
