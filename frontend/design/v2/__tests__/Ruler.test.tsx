import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Ruler, type RulerProps } from "../Ruler";
import { setLang } from "@/lib/v2/i18n";
import { breachNames, capSentence, findSystem, labelsOverlap, spreadLabels, moduleFromSlug, moduleSlug, readingText, rulerGeometry, scoreY, segmentShares, systemSlug, WEIGHT_PERCENT } from "@/lib/v2/score";

const MM = [62, 72, 70, 88, 90, 65];

const props = (over: Partial<RulerProps> = {}): RulerProps => ({
  size: 48,
  dims: MM,
  measured: 71.8,
  score: 70,
  capped: true,
  capLevel: 70,
  breaches: ["MM003", "MM035"],
  label: "Material master",
  records: 61816,
  rules: 913,
  coverage: 0.974,
  ...over,
});

describe("ruler labels never collide", () => {
  const layouts = [
    { name: "1440 px wide", opts: {} },
    { name: "320 px wide (a phone: 288 px of canvas)", opts: { compact: true, available: 288 } },
  ];
  const langs = ["en", "de", "ja"] as const;
  it.each(langs.flatMap((lang) => layouts.map((l) => [lang, l.name, l.opts] as const)))("%s at %s", (lang, _name, opts) => {
    setLang(lang);
    try {
      for (const dims of [MM, [100, 100, 100, 100, 100, 100], [null, null, null, null, null, null]]) {
        const g = rulerGeometry(240, dims, 71.8, opts);
        expect(g.labels.length).toBeGreaterThanOrEqual(5 + 2 + 12);
        for (const l of g.labels) {
          expect(l.x, `${l.text} starts inside the drawing`).toBeGreaterThanOrEqual(0);
          expect(l.x + l.width, `${l.text} ends inside the drawing`).toBeLessThanOrEqual(g.viewWidth);
          expect(l.y + l.height, `${l.text} sits inside the drawing`).toBeLessThanOrEqual(g.viewHeight);
        }
        for (let i = 0; i < g.labels.length; i++)
          for (let j = i + 1; j < g.labels.length; j++) expect(labelsOverlap(g.labels[i], g.labels[j]), `${g.labels[i].text} and ${g.labels[j].text}`).toBe(false);
        if (opts.available) expect(g.viewWidth).toBeLessThanOrEqual(opts.available);
      }
    } finally {
      setLang("en");
    }
  });

  it("spreads labels that would sit on each other and keeps their order", () => {
    const out = spreadLabels([{ y: 10, height: 14 }, { y: 12, height: 14 }, { y: 60, height: 14 }]);
    expect(out.map((l) => l.y)).toEqual([10, 26, 60]);
  });
});

describe("ruler geometry", () => {
  it.each([48, 240] as const)("six segments at weights 25/25/20/10/10/10 that fill the plot at size %i", (size) => {
    const g = rulerGeometry(size, MM, 71.8);
    expect(g.segments).toHaveLength(6);
    expect(WEIGHT_PERCENT).toEqual([25, 25, 20, 10, 10, 10]);
    const shares = segmentShares(g);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    shares.forEach((s, i) => expect(s).toBeCloseTo(WEIGHT_PERCENT[i], 0));
    const widths = g.segments.reduce((a, s) => a + s.width, 0);
    expect(widths + g.gap * 5).toBeCloseTo(g.plot.width, 0);
  });

  it("places each segment after the one before it with the gap between", () => {
    const g = rulerGeometry(240, MM, 71.8);
    for (let i = 1; i < g.segments.length; i++) {
      const prev = g.segments[i - 1];
      expect(g.segments[i].x).toBeCloseTo(prev.x + prev.width + g.gap, 1);
    }
    expect(g.segments[0].x).toBe(g.plot.left);
  });

  it("fills each segment from the bottom to its own score", () => {
    const g = rulerGeometry(240, MM, 71.8);
    g.segments.forEach((s, i) => {
      expect(s.fillHeight).toBeCloseTo((g.plot.height * MM[i]) / 100, 1);
      expect(s.fillY + s.fillHeight).toBeCloseTo(g.plot.top + g.plot.height, 1);
    });
  });

  it("puts the measured tick at the measured score, not the capped one", () => {
    const g = rulerGeometry(240, MM, 71.8);
    expect(g.tickY).toBeCloseTo(scoreY(71.8, g.plot.top, g.plot.height), 2);
    expect(g.tickY).toBeCloseTo(8 + 140 * (1 - 0.718), 1);
    expect(scoreY(100, 8, 140)).toBe(8);
    expect(scoreY(0, 8, 140)).toBe(148);
    expect(scoreY(250, 8, 140)).toBe(8);
    const small = rulerGeometry(48, MM, 71.8);
    expect(small.tickY).toBeCloseTo(12 * (1 - 0.718), 1);
  });

  it("draws the 0 to 100 axis with the 60, 75 and 90 band marks and the 70 and 85 cap ticks at 240 only", () => {
    const big = rulerGeometry(240, MM, 71.8);
    expect(big.axis.filter((a) => a.kind === "band").map((a) => a.value)).toEqual([60, 75, 90]);
    expect(big.axis.filter((a) => a.kind === "scale").map((a) => a.value)).toEqual([0, 25, 50, 100]);
    expect(big.caps.map((c) => c.value)).toEqual([85, 70]);
    expect(big.caps[0].y).toBeLessThan(big.caps[1].y); // 85 sits above 70
    const small = rulerGeometry(48, MM, 71.8);
    expect(small.axis).toHaveLength(0);
    expect(small.caps).toHaveLength(0);
  });

  it("draws an unmeasured dimension as an empty track and a missing measured score as no tick", () => {
    const g = rulerGeometry(48, [62, null, 70, 88, 90, 65], null);
    expect(g.segments[1].fillHeight).toBe(0);
    expect(g.segments[1].score).toBeNull();
    expect(g.tickY).toBeNull();
  });
});

describe("score wording", () => {
  it("reads a capped score in full: measured, shown, the cap and what caps it", () => {
    const text = readingText({ label: "Material master", measured: 71.8, score: 70, capped: true, capLevel: 70, breaches: ["MM003", "MM035"], dims: MM, records: 61816, rules: 913, coverage: 0.974, lowConfidence: false });
    expect(text).toContain("measured 71.8, shown 70.0, capped at 70 by MM003 and MM035");
    expect(text).toContain("Completeness 62");
    expect(text).toContain("61,816 records checked, 913 rules measured, coverage 97.4%");
  });

  it("names the count when more than two rules cap it, and says low confidence", () => {
    expect(breachNames(["A", "B", "C"])).toBe("3 critical rules over tolerance");
    const text = readingText({ label: "Plant maintenance", measured: 73.5, score: 70, capped: true, capLevel: 70, breaches: ["A", "B", "C"], dims: MM, records: 15964, rules: 233, coverage: 0.642, lowConfidence: true });
    expect(text).toContain("capped at 70 by 3 critical rules over tolerance");
    expect(text).toContain("low confidence");
  });

  it("says not measured for a missing dimension and shows a dash for a missing figure", () => {
    const text = readingText({ label: "X", measured: null, score: null, capped: false, capLevel: null, breaches: [], dims: [null, 1, 1, 1, 1, 1], records: null, rules: null, coverage: null, lowConfidence: false });
    expect(text).toContain("Completeness not measured");
    expect(text).toContain("measured —, shown —");
  });

  it("states what caps a score, or that nothing does", () => {
    expect(capSentence(true, 70, ["MM003", "MM035"])).toBe("Capped at 70 by MM003 and MM035, two critical rules over tolerance.");
    expect(capSentence(true, 85, ["PS004"])).toBe("Capped at 85 by PS004, one critical rule over tolerance.");
    expect(capSentence(false, null, [])).toBe("No critical rule is over tolerance, so nothing caps this score.");
  });

  it("maps modules and systems to address segments and back", () => {
    expect(moduleSlug("material_master")).toBe("material-master");
    expect(moduleFromSlug("material-master")).toBe("material_master");
    expect(systemSlug("ECC production")).toBe("ecc-production");
    const systems = [{ id: "a-1", name: "ECC production" }, { id: "b-2", name: "S/4HANA sandbox" }];
    expect(findSystem(systems, "ecc-production")?.id).toBe("a-1");
    expect(findSystem(systems, "b-2")?.name).toBe("S/4HANA sandbox");
    expect(findSystem(systems, "nope")).toBeUndefined();
  });
});

describe("<Ruler>", () => {
  it("at 48 shows the shown score, the word capped and the full reading in the title", () => {
    const { container } = render(<Ruler {...props()} />);
    expect(screen.getByTestId("ruler-score")).toHaveTextContent("70.0");
    expect(screen.getByText("capped")).toBeInTheDocument();
    const box = container.querySelector(".m2-ruler-box");
    expect(box?.getAttribute("title")).toContain("capped at 70 by MM003 and MM035");
    expect(screen.getByRole("img")).toHaveAccessibleName(/Material master: measured 71\.8, shown 70\.0/);
    expect(container.querySelectorAll(".m2-seg")).toHaveLength(6);
    expect(container.querySelectorAll(".m2-ks, .m2-k")).toHaveLength(2);
  });

  it("does not say capped when no cap applies", () => {
    render(<Ruler {...props({ capped: false, capLevel: null, breaches: [], score: 93.4, measured: 93.4 })} />);
    expect(screen.queryByText("capped")).toBeNull();
    expect(screen.getByTestId("ruler-score")).toHaveTextContent("93.4");
  });

  it("at 240 draws the axis labels, the cap ticks and the six scores under the segments", () => {
    const { container } = render(<Ruler {...props({ size: 240, selected: true })} />);
    for (const label of ["60 critical", "75 at risk", "90 go", "cap 1 critical", "cap 2 or more"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector('[data-cap="85"]')).not.toBeNull();
    expect(container.querySelector('[data-cap="70"]')).not.toBeNull();
    expect(container.querySelector(".m2-ruler.m2-on")).not.toBeNull();
    const own = (sel: string) => Array.from(container.querySelectorAll(sel)).map((n) => n.lastChild?.textContent);
    expect(own('[data-label="score"]')).toEqual(["62", "72", "70", "88", "90", "65"]);
    // Each segment is named under it, the letters of the formula, with the full name on hover.
    expect(own('[data-label="dimension"]')).toEqual(["C", "A", "Cs", "T", "U", "V"]);
    expect(Array.from(container.querySelectorAll('[data-label="dimension"] title')).map((n) => n.textContent)).toEqual(["Completeness", "Accuracy", "Consistency", "Timeliness", "Uniqueness", "Validity"]);
  });

  it("says the measured score beside a capped one, so capped objects still rank", () => {
    render(<Ruler {...props()} />);
    expect(screen.getByTestId("ruler-score")).toHaveTextContent("70.0");
    expect(screen.getByText("capped")).toBeInTheDocument();
    expect(screen.getByTestId("ruler-measured")).toHaveTextContent("71.8 measured");
  });

  it("draws an object with no run as an empty bar with a dash", () => {
    const { container } = render(<Ruler {...props({ empty: true })} />);
    expect(screen.getByTestId("ruler-score")).toHaveTextContent("—");
    expect(container.querySelector(".m2-tick")).toBeNull();
    expect(screen.getByRole("img")).toHaveAccessibleName("Material master: no run yet.");
  });
});
