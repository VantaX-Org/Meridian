import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SIZE } from "../_components/layout";

describe("designer task node slot", () => {
  it("CSS height matches the layout slot", () => {
    const css = readFileSync(join(__dirname, "../designer.css"), "utf8");
    const m = css.match(/\.m-process-node\s*\{[^}]*?\bheight:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(SIZE.task.h);
  });
});
