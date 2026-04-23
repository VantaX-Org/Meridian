/**
 * Aurora <Drawer> — WS4.
 *
 * Right-anchored slide-over used by Workbench's record detail, config-impact
 * drill, process-graph node inspector, and any other deep-dive that must
 * keep the list in context. Width target: ~40 % of viewport per spec §9.
 *
 * URL-routable: the drawer can be bound to a URL search param so Back /
 * Forward navigate drawer state. Consumers pass the current param value;
 * a helper `useDrawerParam` (hooks/drawer.ts) is provided for the common
 * case of a single `drawer=<id>` param.
 *
 * Keyboard contract:
 *   Esc      close
 *   Tab      focus trap inside the drawer
 *   ↑ / ↓    consumer-controlled (see Workbench for J/K stepping)
 *
 * Under `prefers-reduced-motion` the slide becomes instant (medium / slow
 * tokens are zeroed in aurora.css).
 */

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { clsx } from "../primitives/internal";

export interface DrawerProps {
  /** Whether the drawer is rendered. Controls mount / unmount. */
  open: boolean;
  /** Called when Esc / scrim-click dismisses. */
  onClose: () => void;
  /** Header content — typically a title + status chip. */
  header?: ReactNode;
  /** Sticky footer action bar. */
  footer?: ReactNode;
  /** Drawer body. */
  children: ReactNode;
  /** Optional aria-label when no visible header text is available. */
  ariaLabel?: string;
  /** Optional aria-labelledby pointing at the header's id. */
  ariaLabelledBy?: string;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  header,
  footer,
  children,
  ariaLabel,
  ariaLabelledBy,
  className,
}: DrawerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus trap + restore.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Focus the first focusable element inside the drawer.
    const el = rootRef.current;
    if (el) {
      const focusable = el.querySelector<HTMLElement>(
        'a, button, [tabindex="0"], input, select, textarea',
      );
      focusable?.focus();
    }
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        // Minimal tab trap — we don't prevent tabbing, we just prevent
        // leaving the drawer.
        const root = rootRef.current;
        if (!root) return;
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(
            'a, button, [tabindex="0"], input, select, textarea',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className={clsx("aurora-drawer__scrim", className)}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={rootRef}
        className="aurora-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onKeyDown={onKeyDown}
      >
        {header ? <div className="aurora-drawer__header">{header}</div> : null}
        <div className="aurora-drawer__body">{children}</div>
        {footer ? <div className="aurora-drawer__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
