import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
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

  it("says what it is, in the interface's language: a licensed mark whose attribution is required", async () => {
    const { setLang } = await import("@/lib/v2/i18n");
    const prefs = await import("@/lib/preferences");
    const { setFormatPrefs } = await import("@/lib/format");
    render(<Attribution />);
    const el = screen.getByTestId("aletheia-attribution");
    expect(el).toHaveAttribute("title", expect.stringContaining("Aletheia is a licensed mark. Its licence requires this attribution on every screen"));
    expect(el).toHaveTextContent("licensed mark, attribution required");
    try {
      prefs.setPreferences({ locale: "de-DE" });
      const de = render(<Attribution />);
      await waitFor(() => expect(within(de.container).getByTestId("aletheia-attribution")).toHaveAttribute("title", expect.stringContaining("Aletheia ist eine lizenzierte Marke")));
      de.unmount();
      prefs.setPreferences({ locale: "ja-JP" });
      const ja = render(<Attribution />);
      await waitFor(() => expect(within(ja.container).getByTestId("aletheia-attribution")).toHaveTextContent("ライセンスマーク"));
    } finally {
      window.localStorage.clear();
      prefs.resetPreferencesCache();
      setLang("en");
      setFormatPrefs({});
    }
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

  it("is reserved out of the shell's height, so the map, canvas and inspector and the strip fit one screen", () => {
    const shell = readFileSync(join(root, "design/v2/v2.css"), "utf8");
    expect(shell).toMatch(/height: calc\(100dvh - var\(--m-attribution-h, 0px\)\)/);
  });

  it("ships Aletheia's own mark file, byte for byte", () => {
    const shipped = readFileSync(join(root, "public/brand/aletheia-mark.svg"), "utf8");
    expect(shipped).toContain('viewBox="290 220 420 420"');
    expect(shipped.length).toBe(1141);
  });
});
