import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  /** "aletheia" paints the button in the violet Aletheia tokens. */
  tone?: "aletheia";
  /** With an href the button renders as a link. */
  href?: string;
  children: ReactNode;
}

/** A pill button. One primary per page header; secondary and ghost for the rest. */
export function Button({ variant = "secondary", tone, href, children, type = "button", ...rest }: Props) {
  const cls = "mx-btn";
  if (href && !rest.disabled) return <Link href={href} className={cls} data-variant={variant} data-tone={tone}>{children}</Link>;
  return <button type={type} className={cls} data-variant={variant} data-tone={tone} {...rest}>{children}</button>;
}
