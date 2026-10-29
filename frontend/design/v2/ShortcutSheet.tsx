"use client";

import { useEffect, useRef } from "react";
import { sheetGroups } from "@/lib/v2/keys";
import { IconClose } from "./marks";

/** The "?" sheet. Drawn from the key registry (lib/v2/keys.ts), so it can never list a key that does nothing. */
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "Tab") e.preventDefault();
      }}
    >
      <div className="m2-scrim" onClick={onClose} aria-hidden="true" />
      <div className="m2-pal m2-sheetkeys" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="shortcut-sheet">
        <div className="m2-sheetkeys-h">
          <h2>Keyboard shortcuts</h2>
          <button ref={close} type="button" className="m2-x" onClick={onClose} aria-label="Close shortcuts">
            <IconClose />
            <span className="m2-x-t">Close</span>
          </button>
        </div>
        <div className="m2-sheetkeys-b">
          {sheetGroups().map((g) => (
            <section key={g.scope}>
              <h3>{g.title}</h3>
              <dl>
                {g.items.map((k) => (
                  <div key={k.id}>
                    <dt>{k.display}</dt>
                    <dd>{k.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
