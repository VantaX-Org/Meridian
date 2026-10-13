import { beforeEach, describe, expect, it } from "vitest";
import { readPrefs, resetPreferencesCache } from "@/lib/preferences";
import { isTourDone, markTourDone, readSeenVersion, resetTour, writeSeenVersion } from "./storage";

beforeEach(() => {
  localStorage.clear();
  resetPreferencesCache();
});

describe("help storage on user preferences", () => {
  it("marks tours done without duplicates", () => {
    markTourDone("a");
    markTourDone("a");
    markTourDone("b");
    expect(readPrefs().tours_done).toEqual(["a", "b"]);
    expect(isTourDone("a")).toBe(true);
    expect(isTourDone("c")).toBe(false);
  });

  it("removes a tour and drops the list when it empties", () => {
    markTourDone("a");
    markTourDone("b");
    resetTour("a");
    expect(readPrefs().tours_done).toEqual(["b"]);
    resetTour("b");
    expect(readPrefs().tours_done).toBeUndefined();
  });

  it("keeps the seen version", () => {
    expect(readSeenVersion()).toBeNull();
    writeSeenVersion("1.2.3");
    expect(readSeenVersion()).toBe("1.2.3");
  });
});
