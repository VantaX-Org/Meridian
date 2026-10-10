// frontend/lib/job-tray-bus.ts
// Lets any component (e.g. the home page's "Jobs running" tile) open the
// TopBar's JobTray drawer without threading open-state through props.
const bus = new EventTarget();
const OPEN = "open";

export function openJobTray(): void {
  bus.dispatchEvent(new Event(OPEN));
}

/** Call from an effect; returns the unsubscribe function. */
export function onJobTrayOpen(cb: () => void): () => void {
  bus.addEventListener(OPEN, cb);
  return () => bus.removeEventListener(OPEN, cb);
}
