"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Button, startTour, useActiveTourId } from "@/design";
import { useFirstRunChecklist } from "@/hooks/use-first-run-checklist";
import { useRole } from "@/hooks/use-role";
import { FIRST_RUN_TOUR_ID, tourById } from "@/lib/help/tours";
import { dismissChecklist, isChecklistDismissed, isTourDone, markTourDone, subscribeStorage } from "@/lib/help/storage";

/** The open setup steps named in the row; the rest are one count away. */
const NAMED_STEPS = 2;

/**
 * What a new person sees under the ledger of a persona home, in one compact row: the first-run tour offer and, for
 * whoever sets the tenant up, the open steps of the setup checklist. Each half goes when it is done or dismissed,
 * and the row goes with them.
 */
export function HomeOnboarding() {
  const { items, loading } = useFirstRunChecklist();
  const { can } = useRole();
  const activeTour = useActiveTourId();
  // Treated as done and dismissed on the server and during hydration, so neither flashes.
  const dismissed = useSyncExternalStore(subscribeStorage, isChecklistDismissed, () => true);
  const tourDone = useSyncExternalStore(subscribeStorage, () => isTourDone(FIRST_RUN_TOUR_ID), () => true);

  const offerTour = !!tourById(FIRST_RUN_TOUR_ID) && !tourDone && !activeTour;
  const open = items.filter((i) => !i.done);
  const showChecklist = !loading && !dismissed && can("manage_systems") && items.length > 0 && open.length > 0;
  if (!offerTour && !showChecklist) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[var(--m-radius-control)] border px-4 py-2 m-text-body [border-color:var(--m-line)] [background:var(--m-sheet)]"
      data-testid="home-onboarding"
    >
      {showChecklist && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1" data-tour="first-run-checklist" data-testid="first-run-checklist">
          <span className="font-semibold">Get set up</span>
          <span className="m-text-meta m-ink-3">{items.length - open.length} of {items.length} done</span>
          <ul className="flex flex-wrap items-center gap-x-4">
            {open.slice(0, NAMED_STEPS).map((item) => (
              <li key={item.id}><Link href={item.href} className="m-ink-accent">{item.label}</Link></li>
            ))}
            {open.length > NAMED_STEPS && <li className="m-ink-3">and {open.length - NAMED_STEPS} more</li>}
          </ul>
          <Button variant="ghost" size="sm" onClick={dismissChecklist}>Dismiss</Button>
        </div>
      )}
      {offerTour && (
        <div className="ml-auto flex items-center gap-2">
          <span className="m-ink-2">New here? A short tour shows where things are</span>
          <Button variant="ghost" size="sm" onClick={() => markTourDone(FIRST_RUN_TOUR_ID)}>Not now</Button>
          <Button variant="secondary" size="sm" onClick={() => startTour(FIRST_RUN_TOUR_ID)}>Take the tour</Button>
        </div>
      )}
    </div>
  );
}
