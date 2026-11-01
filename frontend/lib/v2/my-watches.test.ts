import { describe, expect, it } from "vitest";
import { watchEventsLine } from "@/design/v2/inspector/collab";
import { fixtureResponse, fixtureWrite } from "@/lib/api/v2/fixtures";

describe("my watches", () => {
  it("lists watches with a date and drops one after it is deleted", async () => {
    const before = (await fixtureResponse("/watches/mine", {})) as { watches: { target_id: string; created_at: string }[] };
    expect(before.watches.length).toBeGreaterThan(0);
    const first = before.watches[0];
    expect(first.created_at).toBeTruthy();
    await fixtureWrite("DELETE", "/watches", undefined, { target_kind: "object", target_id: first.target_id });
    const after = (await fixtureResponse("/watches/mine", {})) as { watches: { target_id: string }[] };
    expect(after.watches.find((w) => w.target_id === first.target_id)).toBeUndefined();
  });

  it("says all events when none are chosen", () => {
    expect(watchEventsLine([])).toBe("All events");
    expect(watchEventsLine(["comment", "score_dropped"])).toBe("Comments, Score drops");
  });
});
