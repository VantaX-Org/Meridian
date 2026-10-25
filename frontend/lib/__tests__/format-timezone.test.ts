import { afterEach, describe, expect, it } from "vitest";
import { browserTimezone, formatDate, isValidTimeZone, setFormatPrefs, setTenantTimezone } from "../format";

afterEach(() => { setTenantTimezone(null); setFormatPrefs({}); });

describe("formatDate time zones", () => {
  const instant = "2026-01-02T22:00:00Z";

  it("labels a time read in an explicit IANA zone", () => {
    expect(formatDate(instant, "datetime", "Africa/Johannesburg")).toBe("3 Jan 2026, 00:00 GMT+2");
    expect(formatDate(instant, "datetime", "UTC")).toBe("2 Jan 2026, 22:00 UTC");
    expect(formatDate(instant, "date", "Africa/Johannesburg")).toBe("3 Jan 2026");
  });

  it("defaults to the tenant zone, and the user's own zone wins over it", () => {
    expect(formatDate(instant, "datetime")).toBe("2 Jan 2026, 22:00");
    setTenantTimezone("Asia/Tokyo");
    expect(formatDate(instant, "datetime")).toBe("3 Jan 2026, 07:00");
    setFormatPrefs({ timezone: "Europe/London" });
    expect(formatDate(instant, "datetime")).toBe("2 Jan 2026, 22:00");
  });

  it("falls back to UTC on an unknown zone and knows the browser's zone", () => {
    expect(formatDate(instant, "datetime", "Mars/Olympus")).toBe("2 Jan 2026, 22:00 UTC");
    expect(browserTimezone()).toMatch(/\S/);
  });

  it("accepts IANA zones and rejects anything else", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});
