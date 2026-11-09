"use client";

import { useEffect } from "react";

/** The same list basis.css turns into its own sideways scroller below 760px. */
const SCROLLERS = ".m2-root :is(.m2-tbl, .m2-rcpt, .m2-ck-matrix, .m2-ck-rules, .m2-ck-mini):not(.m2-cards)";

/**
 * A table that scrolls sideways is a scroll region, and a scroll region must be reachable by keyboard (WCAG 2.1.1,
 * axe scrollable-region-focusable). Every one that actually overflows gets tabindex 0, and loses it again once it
 * fits, so wide screens keep their tab order. One watcher for the whole app, not a prop on each table.
 */
export function useKeyboardScrollers(): void {
  useEffect(() => {
    let frame = 0;
    const mark = () => {
      frame = 0;
      for (const el of document.querySelectorAll<HTMLElement>(SCROLLERS)) {
        const scrolls = el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible";
        const ours = el.hasAttribute("data-m2-scroll");
        if (scrolls && !ours && !el.hasAttribute("tabindex")) {
          el.tabIndex = 0;
          el.setAttribute("data-m2-scroll", "");
        } else if (!scrolls && ours) {
          el.removeAttribute("tabindex");
          el.removeAttribute("data-m2-scroll");
        }
      }
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(mark);
    };
    queue();
    const watch = new MutationObserver(queue);
    watch.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", queue);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", queue);
      cancelAnimationFrame(frame);
    };
  }, []);
}
