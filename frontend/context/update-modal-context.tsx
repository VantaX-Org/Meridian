"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

/**
 * localStorage key holding the `latest_version` string the admin last
 * snoozed via "Remind Me Later" on the update-available modal. Exported so
 * other code (e.g. a future settings page) can read/clear it consistently.
 */
export const UPDATE_SNOOZE_KEY = "mn_update_snoozed_version";

interface UpdateModalContextValue {
  /**
   * Bumped every time something asks the modal to force-open, bypassing
   * any snooze. `<UpdateAvailableModal />` watches this value.
   */
  openSignal: number;
  /** Clears any stored snooze and asks the update modal to open immediately. */
  open: () => void;
}

const UpdateModalContext = createContext<UpdateModalContextValue>({
  openSignal: 0,
  open: () => {},
});

/**
 * Thin cross-component trigger so the Admin page's "Check for Updates"
 * button can force-reopen `<UpdateAvailableModal />` (mounted once, up in
 * the dashboard layout) even if the admin already snoozed this version.
 * The actual update-status data is fetched independently by each consumer
 * via the shared `["system-update-status"]` react-query cache key — this
 * context only carries the "please open" signal, not the data itself.
 */
export function UpdateModalProvider({ children }: { children: ReactNode }) {
  const [openSignal, setOpenSignal] = useState(0);

  const open = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(UPDATE_SNOOZE_KEY);
    }
    setOpenSignal((n) => n + 1);
  }, []);

  return (
    <UpdateModalContext.Provider value={{ openSignal, open }}>
      {children}
    </UpdateModalContext.Provider>
  );
}

export function useUpdateModal(): UpdateModalContextValue {
  return useContext(UpdateModalContext);
}
