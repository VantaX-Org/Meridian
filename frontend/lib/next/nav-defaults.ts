/** The five tabs of the Story feed, in order. */
export const PATHS = {
  home: "/",
  work: "/work",
  load: "/load",
  runs: "/runs",
  more: "/admin",
} as const;
export type DestId = keyof typeof PATHS;
export const TABS: readonly DestId[] = ["home", "work", "load", "runs", "more"];
