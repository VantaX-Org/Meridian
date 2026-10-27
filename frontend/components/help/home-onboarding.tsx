"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button, Notice, startTour, useActiveTourId } from "@/design";
import { useFirstRunChecklist } from "@/hooks/use-first-run-checklist";
import { useRole } from "@/hooks/use-role";
import { FIRST_RUN_TOUR_ID, tourById } from "@/lib/help/tours";
import {
  closeTourOffer, dismissChecklist, isChecklistDismissed, isTourDone, isTourOfferClosed, markTourOfferedThisSession,
  subscribeStorage, wasTourOfferedThisSession,
} from "@/lib/help/storage";

/** The open setup steps named in the row; the rest are one count away. */
const NAMED_STEPS = 2;

/**
 * What a new person sees at the top of a persona home, as one notice: the first-run tour offer and, for whoever
 * sets the tenant up, the open steps of the setup checklist. Each half goes when it is done or dismissed, and the
 * notice goes with them, so a set-up tenant never sees it. The tour offer shows until it is taken or put off (kept
 * on the account and on this device), and at most once per browser session: the next home leaves it out.
 */
export function HomeOnboarding() {
  const { items, loading } = useFirstRunChecklist();
  const { can } = useRole();
  const activeTour = useActiveTourId();
  // Treated as done and dismissed on the server and during hydration, so neither flashes.
  const dismissed = useSyncExternalStore(subscribeStorage, isChecklistDismissed, () => true);
  const tourDone = useSyncExternalStore(subscribeStorage, () => isTourDone(FIRST_RUN_TOUR_ID) || isTourOfferClosed(FIRST_RUN_TOUR_ID), () => true);
  // Read once per mount: an offer already shown earlier this session stays away; this mount keeps the one it shows.
  const [shownBefore] = useState(() => typeof window !== "undefined" && wasTourOfferedThisSession(FIRST_RUN_TOUR_ID));

  const offerTour = !!tourById(FIRST_RUN_TOUR_ID) && !tourDone && !activeTour && !shownBefore;
  useEffect(() => {
    if (offerTour) markTourOfferedThisSession(FIRST_RUN_TOUR_ID);
  }, [offerTour]);
  const open = items.filter((i) => !i.done);
  const showChecklist = !loading && !dismissed && can("manage_systems") && items.length > 0 && open.length > 0;
  if (!offerTour && !showChecklist) return null;

  return (
    <div data-testid="home-onboarding">
      <Notice
        tone="info"
        title={showChecklist ? "Get set up" : undefined}
        action={
          <>
            {showChecklist && <Button variant="ghost" size="sm" onClick={dismissChecklist}>Dismiss</Button>}
            {offerTour && <Button variant="ghost" size="sm" onClick={() => closeTourOffer(FIRST_RUN_TOUR_ID)}>Not now</Button>}
            {/* Taking the tour closes the offer too, finished or not; the help menu replays it. */}
            {offerTour && <Button variant="secondary" size="sm" onClick={() => { closeTourOffer(FIRST_RUN_TOUR_ID); startTour(FIRST_RUN_TOUR_ID); }}>Take the tour</Button>}
          </>
        }
      >
        <div className="flex flex-col gap-1">
          {showChecklist && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1" data-tour="first-run-checklist" data-testid="first-run-checklist">
              <span className="m-text-meta m-ink-3">{items.length - open.length} of {items.length} done</span>
              <ul className="flex flex-wrap items-center gap-x-4">
                {open.slice(0, NAMED_STEPS).map((item) => (
                  <li key={item.id}><Link href={item.href} className="m-ink-accent">{item.label}</Link></li>
                ))}
                {open.length > NAMED_STEPS && <li className="m-ink-3">and {open.length - NAMED_STEPS} more</li>}
              </ul>
            </div>
          )}
          {offerTour && <span>New here? A short tour shows where things are</span>}
        </div>
      </Notice>
    </div>
  );
}
