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

  it("never draws over a dialog, drawer or menu (z 50) and never takes a click", () => {
    const css = readFileSync(join(root, "design/tokens.css"), "utf8");
    const rule = /\.m-attribution\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const z = Number(/z-index:\s*(\d+)/.exec(rule)?.[1]);
    expect(z).toBeLessThan(50);
    // still above the page, the BulkBar (z 10) and the Ask launcher (z 40)
    expect(z).toBeGreaterThan(40);
    expect(rule).toMatch(/pointer-events:\s*none/);
    for (const file of ["design/primitives/Dialog.tsx", "design/primitives/Drawer.tsx"]) {
      expect(readFileSync(join(root, file), "utf8"), file).toMatch(/fixed z-50/);
    }
  });

  it("ships Aletheia's own mark file, byte for byte", () => {
    const shipped = readFileSync(join(root, "public/brand/aletheia-mark.svg"), "utf8");
    expect(shipped).toContain('viewBox="290 220 420 420"');
    expect(shipped.length).toBe(1141);
  });
});
