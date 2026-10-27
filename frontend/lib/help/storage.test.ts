import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPrefs, resetPreferencesCache } from "@/lib/preferences";
import {
  closeTourOffer, isTourDone, isTourOfferClosed, markTourDone, markTourOfferedThisSession, readSeenVersion, resetTour,
  wasTourOfferedThisSession, writeSeenVersion,
} from "./storage";

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

describe("first-run tour offer", () => {
  beforeEach(() => sessionStorage.clear());

  it("closes the offer on the account and on this device", () => {
    expect(isTourOfferClosed("first-run")).toBe(false);
    closeTourOffer("first-run");
    expect(isTourOfferClosed("first-run")).toBe(true);
    expect(isTourDone("first-run")).toBe(true);
  });

  it("remembers the offer was shown in this session", () => {
    expect(wasTourOfferedThisSession("first-run")).toBe(false);
    markTourOfferedThisSession("first-run");
    expect(wasTourOfferedThisSession("first-run")).toBe(true);
  });

  it("treats blocked session storage as never shown, without throwing", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => markTourOfferedThisSession("first-run")).not.toThrow();
    expect(wasTourOfferedThisSession("first-run")).toBe(false);
    get.mockRestore();
    set.mockRestore();
  });
});
