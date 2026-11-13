"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { Button } from "./Button";

export interface LargeTitleProps {
  title: string;
  subtitle?: string;
  /** The one primary action of the screen. */
  primary?: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean; reason?: ReactNode };
  /** A score ruler, a status chip. */
  meta?: ReactNode;
  className?: string;
}

/**
 * The big screen title. A sentinel under it tells the nearest [data-title-scope] when the title has scrolled away
 * (data-collapsed="true"), which is what shows the Toolbar title. No scope, no effect.
 */
export function LargeTitle({ title, subtitle, primary, meta, className, ...rest }: LargeTitleProps & Record<`data-${string}`, string | undefined>) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    const scope = el?.closest<HTMLElement>("[data-title-scope]");
    if (!el || !scope || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => {
      const e = es[es.length - 1];
      if (e) scope.dataset.collapsed = String(!e.isIntersecting);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      delete scope.dataset.collapsed;
    };
  }, []);
  return (
    <>
      <header className={cx("nx-lt", className)} {...rest}>
        <div className="nx-lt-text">
          <h1 className="nx-lt-h">{title}</h1>
          {subtitle ? <p className="nx-lt-sub">{subtitle}</p> : null}
        </div>
        {meta ? <div className="nx-lt-meta">{meta}</div> : null}
        {primary ? (
          <Button variant="primary" onClick={primary.onClick} disabled={primary.disabled} reason={primary.reason} loading={primary.busy}>{primary.label}</Button>
        ) : null}
      </header>
      <div ref={sentinel} className="nx-lt-sentinel" aria-hidden="true" />
    </>
  );
}
