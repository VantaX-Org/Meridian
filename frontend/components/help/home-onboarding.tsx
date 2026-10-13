"use client";

import { useSyncExternalStore } from "react";
import { FirstRunChecklist, TourOffer } from "@/design";
import { useFirstRunChecklist } from "@/hooks/use-first-run-checklist";
import { FIRST_RUN_TOUR_ID } from "@/lib/help/tours";
import { dismissChecklist, isChecklistDismissed, subscribeStorage } from "@/lib/help/storage";

/** What a new person sees at the top of a persona home: the first-run tour offer and the setup checklist. */
export function HomeOnboarding() {
  const { items, loading } = useFirstRunChecklist();
  // Dismissed on the server and during hydration, so a dismissed checklist never flashes.
  const dismissed = useSyncExternalStore(subscribeStorage, isChecklistDismissed, () => true);
  return (
    <>
      <TourOffer id={FIRST_RUN_TOUR_ID} />
      {!loading && !dismissed && <FirstRunChecklist items={items} onDismiss={dismissChecklist} />}
    </>
  );
}
