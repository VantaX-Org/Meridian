import { describe, expect, it } from "vitest";
import type { Burndown } from "@/lib/api/work-analytics";
import { burndownChart, daysText, finishSentence, PROJECTION_HORIZON_DAYS, rateText } from "../progress-model";

const burn = (over: Partial<Burndown> = {}): Burndown => ({
  version_id: "v", today: "2026-10-25",
  days: [{ day: "2026-10-23", open: 40, opened: 0, closed: 0 }, { day: "2026-10-24", open: 30, opened: 0, closed: 10 }, { day: "2026-10-25", open: 20, opened: 0, closed: 10 }],
  open_now: 20, open_records: 5, fixed_7d: 20, pace_per_day: 2, pace_window_days: 28, projected_finish: "2026-11-04", runs: [], ...over,
});

describe("progress model", () => {
  it("draws open issues per day and the projection down to zero on the finish date", () => {
    const c = burndownChart(burn());
    expect(c.peak).toBe(40);
    expect(c.series[0].data.map((p) => p.y)).toEqual([40, 30, 20]);
    const projected = c.series[1];
    expect(projected.name).toBe("Projected");
    expect(projected.data.map((p) => [p.x, p.y])).toEqual([["2026-10-25", 20], ["2026-11-01", 6], ["2026-11-04", 0]]);
    expect(c.xDomain.map((d) => d.x).slice(-2)).toEqual(["2026-11-01", "2026-11-04"]);
  });

  it("draws no projection without a finish date, and stops at the horizon for a far one", () => {
    expect(burndownChart(burn({ projected_finish: null, pace_per_day: 0 })).series).toHaveLength(1);
    const far = burndownChart(burn({ pace_per_day: 0.1, projected_finish: "2027-04-14" })).series[1].data;
    expect(far[far.length - 1].x).toBe("2027-01-23");
    expect(far).toHaveLength(Math.ceil(PROJECTION_HORIZON_DAYS / 7) + 1);
  });

  it("sets the target line at none open only when the projection is drawn", () => {
    expect(burndownChart(burn()).target).toBe(0);
    expect(burndownChart(burn({ projected_finish: null, pace_per_day: 0 })).target).toBeUndefined();
  });

  it("rounds a per-day rate the way a person says it", () => {
    expect([rateText(0), rateText(0.04), rateText(0.46), rateText(4.333), rateText(12.345678), rateText(-38.6)]).toEqual(["0", "under 0.1", "0.5", "4.3", "12", "39"]);
    expect(finishSentence(burn({ pace_per_day: 2.3456 }))).toBe("At 2.3 a day net, the backlog clears on 4 Nov 2026");
    expect(finishSentence(burn({ projected_finish: null, pace_per_day: -12.789 }))).toBe("More is opening than closing: 13 a day net over 28 days");
  });

  it("words fix times and the finish", () => {
    expect([daysText(null), daysText(0.4), daysText(1), daysText(7.5)]).toEqual(["—", "under a day", "1 day", "7.5 days"]);
    expect(finishSentence(burn())).toBe("At 2 a day net, the backlog clears on 4 Nov 2026");
    expect(finishSentence(burn({ projected_finish: null, pace_per_day: 0 }))).toBe("No net progress over the last 28 days, so there is no finish date");
    expect(finishSentence(burn({ open_now: 0 }))).toBe("Nothing is open");
  });
});
