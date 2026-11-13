"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

export interface LargeTitleProps {
  title: string;
  subtitle?: ReactNode;
  /** The one thing to do on this screen. */
  primary?: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean; reason?: string };
  meta?: ReactNode;
}

/**
 * The big page title. When it scrolls out of view the same words appear small in the header band
 * (`data-collapsed` on the nearest `[data-title-scope]` shows the compact copy portalled into `#nx-title-slot`).
 */
const noopSubscribe = () => () => undefined;

export function LargeTitle({ title, subtitle, primary, meta }: LargeTitleProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const slot = useSyncExternalStore(noopSubscribe, () => document.getElementById("nx-title-slot"), () => null);
  useEffect(() => {
    const el = sentinel.current;
    const scope = el?.closest<HTMLElement>("[data-title-scope]") ?? document.body;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      scope.dataset.collapsed = e.isIntersecting ? "false" : "true";
    });
    io.observe(el);
    return () => {
      io.disconnect();
      delete scope.dataset.collapsed;
    };
  }, []);
  return (
    <header className="nx-lt">
      <div className="nx-lt-text">
        <h1 className="nx-lt-h">{title}</h1>
        {subtitle ? <p className="nx-lt-sub">{subtitle}</p> : null}
      </div>
      {meta ? <div className="nx-lt-meta">{meta}</div> : null}
      {primary ? <Button variant="primary" onClick={primary.onClick} disabled={primary.disabled} loading={primary.busy} reason={primary.reason}>{primary.label}</Button> : null}
      <div ref={sentinel} className="nx-lt-sentinel" aria-hidden="true" />
      {slot ? createPortal(<span className="nx-title-compact">{title}</span>, slot) : null}
    </header>
  );
}
