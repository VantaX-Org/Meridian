"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "../primitives/Button";
import { Card } from "../primitives/Card";
import { Notice } from "../primitives/Notice";
import { TOURS, tourById, type TourDef, type TourPlacement, type TourStep } from "@/lib/help/tours";
import { isTourDone, markTourDone, subscribeStorage } from "@/lib/help/storage";

/* A tiny store so `startTour(id)` can be called from anywhere (the help menu, the first-run offer, a test). */
let activeId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Opens a tour by id. Does nothing visible until a `TourHost` is mounted. */
export function startTour(id: string): void {
  activeId = id;
  emit();
}

export function stopTour(): void {
  activeId = null;
  emit();
}

export function useActiveTourId(): string | null {
  return useSyncExternalStore(subscribe, () => activeId, () => null);
}

const PAD = 6;
const GAP = 12;
const CARD_W = 320;
const CARD_H = 230;
const POLL_EVERY = 100;
const WAIT_FOR_TARGET = 8000;

interface Box { top: number; left: number; width: number; height: number }

const find = (target: string): HTMLElement | null => {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
};

const measure = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/** True when the page already shows `href`: same path, and every query parameter in `href` has the same value now. */
function sameLocation(href: string): boolean {
  try {
    const want = new URL(href, window.location.origin);
    if (want.pathname !== window.location.pathname) return false;
    const have = new URLSearchParams(window.location.search);
    for (const [k, v] of want.searchParams) if (have.get(k) !== v) return false;
    return true;
  } catch {
    return false;
  }
}

function cardPosition(box: Box | null, placement: TourPlacement): { top: number; left: number; transform?: string } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampLeft = (x: number) => Math.max(16, Math.min(x, vw - CARD_W - 16));
  if (!box) return { top: vh / 2, left: vw / 2, transform: "translate(-50%, -50%)" };
  const below = box.top + box.height + PAD + GAP;
  const above = box.top - PAD - GAP;
  const fitsBelow = below + CARD_H <= vh;
  const fitsAbove = above - CARD_H >= 0;
  const fitsRight = box.left + box.width + PAD + GAP + CARD_W <= vw;
  const fitsLeft = box.left - PAD - GAP - CARD_W >= 0;
  const clampTop = (y: number) => Math.max(16, Math.min(y, vh - CARD_H - 16));
  let side: TourPlacement = placement;
  if (side === "bottom" && !fitsBelow) side = fitsAbove ? "top" : fitsRight ? "right" : fitsLeft ? "left" : "bottom";
  else if (side === "top" && !fitsAbove) side = fitsBelow ? "bottom" : fitsRight ? "right" : fitsLeft ? "left" : "top";
  else if (side === "right" && !fitsRight) side = fitsLeft ? "left" : fitsBelow ? "bottom" : "top";
  else if (side === "left" && !fitsLeft) side = fitsRight ? "right" : fitsBelow ? "bottom" : "top";
  if (side === "bottom") return fitsBelow ? { top: below, left: clampLeft(box.left) } : { top: vh - CARD_H - 16, left: clampLeft(box.left) };
  if (side === "top") return fitsAbove ? { top: above, left: clampLeft(box.left), transform: "translateY(-100%)" } : { top: 16, left: clampLeft(box.left) };
  if (side === "right") return { top: clampTop(box.top), left: box.left + box.width + PAD + GAP };
  return { top: clampTop(box.top), left: box.left - PAD - GAP, transform: "translateX(-100%)" };
}

export interface TourHostProps {
  tours?: readonly TourDef[];
  /** Opens a page for a step with an `href`. The Next router's `push` in the app. */
  navigate?: (href: string) => void;
  /** Fills the `{run}` style tokens in a step's `href`; resolves to null when the step cannot apply (the step is skipped). */
  resolveHref?: (href: string) => Promise<string | null> | string | null;
}

/** Renders the running tour, if any. Mount once, in the app layout. */
export function TourHost(props: TourHostProps) {
  const id = useActiveTourId();
  const def = id ? tourById(id, props.tours ?? TOURS) : undefined;
  if (!def) return null;
  return <TourRunner key={def.id} def={def} navigate={props.navigate} resolveHref={props.resolveHref} />;
}

function TourRunner({ def, navigate, resolveHref }: { def: TourDef } & Pick<TourHostProps, "navigate" | "resolveHref">) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [ready, setReady] = useState(false);
  const direction = useRef<1 | -1>(1);
  const cardRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const step: TourStep = def.steps[index];
  const last = index === def.steps.length - 1;

  const close = useCallback((completed: boolean) => {
    if (completed || def.oneShot) markTourDone(def.id);
    stopTour();
    const el = opener.current;
    if (el instanceof HTMLElement) el.focus();
  }, [def.id, def.oneShot]);

  const go = useCallback((to: number, dir: 1 | -1) => {
    direction.current = dir;
    if (to >= def.steps.length) return close(true);
    if (to < 0) return;
    setIndex(to);
  }, [def.steps.length, close]);

  // Bring the step's page and target into view.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let observer: ResizeObserver | undefined;
    let teardownListeners: (() => void) | undefined;
    setReady(false);
    setMissing(false);
    setBox(null);

    const skip = () => (direction.current === -1 && index === 0 ? go(index + 1, 1) : go(index + direction.current, direction.current));

    const show = (el: HTMLElement) => {
      el.scrollIntoView?.({ block: "center", inline: "nearest" });
      const update = () => { if (!cancelled && el.isConnected) setBox(measure(el)); };
      update();
      setReady(true);
      window.addEventListener("resize", update);
      window.addEventListener("scroll", update, true);
      if (typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(update); observer.observe(el); }
      teardownListeners = () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
    };

    const waitForTarget = () => {
      const started = Date.now();
      const look = () => {
        if (cancelled) return;
        const el = find(step.target);
        if (el) { if (timer) clearInterval(timer); show(el); return; }
        if (Date.now() - started >= WAIT_FOR_TARGET) {
          if (timer) clearInterval(timer);
          if (step.optional) skip();
          else { setMissing(true); setReady(true); }
        }
      };
      look();
      if (!cancelled && !timer) timer = setInterval(look, POLL_EVERY);
    };

    void (async () => {
      if (step.href) {
        const href = resolveHref ? await resolveHref(step.href) : step.href;
        if (cancelled) return;
        if (href === null) { skip(); return; }
        if (!sameLocation(href)) navigate?.(href);
      }
      if (!cancelled) waitForTarget();
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      observer?.disconnect();
      teardownListeners?.();
    };
    // `step` is derived from `index`; navigate and resolveHref are stable for the life of a tour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, def.id]);

  // Escape closes from anywhere, before a drawer underneath can see it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [close]);

  // Focus moves to the card on each step.
  useLayoutEffect(() => {
    if (ready) cardRef.current?.querySelector<HTMLElement>("[data-tour-primary]")?.focus();
  }, [ready, index]);

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const lastItem = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !cardRef.current?.contains(active))) { e.preventDefault(); lastItem.focus(); }
    else if (!e.shiftKey && (active === lastItem || !cardRef.current?.contains(active))) { e.preventDefault(); first.focus(); }
  };

  if (typeof document === "undefined") return null;

  const spot = box && !missing ? { top: Math.max(0, box.top - PAD), left: Math.max(0, box.left - PAD), width: box.width + PAD * 2, height: box.height + PAD * 2 } : null;
  const pos = ready ? cardPosition(spot ? box : null, step.placement ?? "bottom") : null;
  const scrim = { position: "fixed" as const, background: "var(--m-scrim)" };

  return createPortal(
    <div data-testid="tour" data-tour-id={def.id} data-tour-step={index} data-tour-target={step.target} data-tour-missing={missing || undefined} onKeyDown={trapTab} style={{ position: "fixed", inset: 0, zIndex: 70 }}>
      {spot ? (
        <>
          <div aria-hidden style={{ ...scrim, top: 0, left: 0, right: 0, height: spot.top }} />
          <div aria-hidden style={{ ...scrim, top: spot.top + spot.height, left: 0, right: 0, bottom: 0 }} />
          <div aria-hidden style={{ ...scrim, top: spot.top, left: 0, width: spot.left, height: spot.height }} />
          <div aria-hidden style={{ ...scrim, top: spot.top, left: spot.left + spot.width, right: 0, height: spot.height }} />
          {/* Blocks clicks into the spotlit element so a tour is not left by following a link inside it. */}
          <div aria-hidden data-testid="tour-spot" style={{ position: "fixed", top: spot.top, left: spot.left, width: spot.width, height: spot.height, borderRadius: "var(--m-radius-sheet)", boxShadow: "var(--m-elev-focus)" }} />
        </>
      ) : (
        <div aria-hidden style={{ ...scrim, inset: 0 }} />
      )}
      {pos && (
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={step.title}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: pos.transform, width: CARD_W, maxWidth: "calc(100vw - 32px)", boxShadow: "var(--m-elev-3)", borderRadius: "var(--m-radius-sheet)" }}
        >
          <Card title={step.title} meta={`Step ${index + 1} of ${def.steps.length}`}>
            <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{step.body}</p>
            {missing && (
              <div className="mt-3">
                <Notice tone="warning">This part of the page is not available to you or has not loaded</Notice>
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="ghost" disabled={index === 0} onClick={() => go(index - 1, -1)}>Back</Button>
              <Button data-tour-primary="" variant="primary" onClick={() => go(index + 1, 1)}>{last ? "Done" : "Next"}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * A one-line offer to take a tour, shown until the tour is done or dismissed.
 * Used for the first-run tour on the persona home pages.
 */
export function TourOffer({ id, tours = TOURS }: { id: string; tours?: readonly TourDef[] }) {
  const def = tourById(id, tours);
  const active = useActiveTourId();
  // Treated as done on the server and during hydration, so the offer appears only once storage has been read.
  const done = useSyncExternalStore(subscribeStorage, () => isTourDone(id), () => true);
  if (!def || done || active) return null;
  return (
    <Notice
      title="New here?"
      action={
        <>
          <Button variant="ghost" onClick={() => markTourDone(id)}>Not now</Button>
          <Button variant="secondary" onClick={() => startTour(id)}>Take the tour</Button>
        </>
      }
    >
      A short tour shows where things are, in three steps
    </Notice>
  );
}
