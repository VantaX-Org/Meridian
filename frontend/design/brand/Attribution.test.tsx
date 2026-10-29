import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Attribution } from "./Attribution";

const root = join(__dirname, "..", "..");

describe("Aletheia attribution (licence section 6: on every screen)", () => {
  it("shows the unaltered mark and the name", () => {
    render(<Attribution />);
    const el = screen.getByTestId("aletheia-attribution");
    expect(el).toHaveTextContent("Aletheia");
    expect(el.querySelector("img")?.getAttribute("src")).toBe("/brand/aletheia-mark.svg");
  });

  it("is rendered by the root layout and by the global error page, so every screen carries it", () => {
    for (const file of ["app/layout.tsx", "app/global-error.tsx"]) {
      expect(readFileSync(join(root, file), "utf8"), file).toMatch(/<Attribution \/>/);
    }
  });

  it("sits in the document flow at the foot of the page, never fixed over content", () => {
    const css = readFileSync(join(root, "design/tokens.css"), "utf8");
    const rule = /\.m-attribution\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).not.toMatch(/position:\s*(fixed|absolute|sticky)/);
    expect(rule).not.toMatch(/z-index/);
    expect(rule).toMatch(/height:\s*var\(--m-attribution-h\)/);
  });

  it("is reserved out of the shell's height, so the app shell and the strip fit one screen", () => {
    const layout = readFileSync(join(root, "app/(app)/layout.tsx"), "utf8");
    expect(layout.match(/calc\(100dvh-var\(--m-attribution-h\)\)/g)).toHaveLength(2);
    expect(layout).not.toMatch(/h-dvh/);
  });

  it("ships Aletheia's own mark file, byte for byte", () => {
    const shipped = readFileSync(join(root, "public/brand/aletheia-mark.svg"), "utf8");
    expect(shipped).toContain('viewBox="290 220 420 420"');
    expect(shipped.length).toBe(1141);
  });
});
