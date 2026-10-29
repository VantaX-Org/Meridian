import { describe, expect, it } from "vitest";
import { detectionMethodLabel } from "../mined-feeds";

describe("anomaly detection method labels", () => {
  it("names the miner's methods in words, never Iqr or Zscore", () => {
    expect(detectionMethodLabel("iqr")).toBe("Interquartile range");
    expect(detectionMethodLabel("zscore")).toBe("Z-score");
    expect(detectionMethodLabel("ZSCORE")).toBe("Z-score");
  });
  it("reads an unknown method as words", () => {
    expect(detectionMethodLabel("isolation_forest")).toBe("Isolation forest");
    expect(detectionMethodLabel(null)).toBe("—");
  });
});
