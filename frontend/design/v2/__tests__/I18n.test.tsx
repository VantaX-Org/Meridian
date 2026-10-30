import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { formatDate, setFormatPrefs } from "@/lib/format";
import { readPrefs, resetPreferencesCache, setPreferences } from "@/lib/preferences";
import { setLang, t, useInterfaceLang } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { V2Shell } from "../shell/V2Shell";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
}

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetPreferencesCache();
  setFormatPrefs({});
  setLang("en");
  resetAdminFixture();
  resetKeptOutcomes();
  stubMatchMedia();
  setUrl("/v2?fixture=1&open=preferences");
});
afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetPreferencesCache();
  setFormatPrefs({});
  setLang("en");
  document.documentElement.lang = "";
  vi.restoreAllMocks();
});

const SAMPLE = "2026-10-16T05:17:00Z";

/** A figure, a date and a word, written the way the v2 canvas writes them. */
function Figure() {
  const { tag } = useInterfaceLang();
  return (
    <p data-testid="figure" lang={tag}>
      {`${t("Score")} ${f1(71.8)}, ${formatDate(SAMPLE, "datetime")}`}
    </p>
  );
}

describe("switching the locale", () => {
  it("re-renders a figure and a date in the new language and number format", async () => {
    renderWithQuery(<Figure />);
    expect(screen.getByTestId("figure")).toHaveTextContent("Score 71.8, 16 Oct 2026, 05:17");
    setPreferences({ locale: "de-DE" });
    await waitFor(() => expect(screen.getByTestId("figure")).toHaveTextContent("Score 71,8, 16. Okt. 2026, 05:17"));
    expect(screen.getByTestId("figure")).toHaveAttribute("lang", "de-DE");
    setPreferences({ locale: "ja-JP" });
    await waitFor(() => expect(screen.getByTestId("figure")).toHaveTextContent("スコア 71.8, 2026年10月16日 05:17"));
    setPreferences({ locale: null });
    await waitFor(() => expect(screen.getByTestId("figure")).toHaveTextContent("Score 71.8"));
  });

  it("the language picker in Preferences changes the shell, the map and the panel, and puts the language on the page", async () => {
    renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
    const dialog = await screen.findByRole("dialog", { name: "Preferences" });
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Places" })).toHaveTextContent("Landscape"));
    fireEvent.change(within(dialog).getByTestId("language-picker"), { target: { value: "de" } });
    expect(readPrefs().locale).toBe("de-DE");
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Orte" })).toHaveTextContent("Landschaft"));
    const de = screen.getByRole("dialog", { name: "Benutzereinstellungen" });
    expect(within(de).getByRole("heading", { name: "Sprache und Region" })).toBeInTheDocument();
    expect(within(de).getByTestId("format-sample")).toHaveTextContent("Scores 71,8, Anzahlen 1.234.567");
    expect(within(de).getByTestId("format-sample")).toHaveTextContent("16. Okt. 2026, 05:17");
    expect(document.querySelector(".m2-root")).toHaveAttribute("lang", "de-DE");
    expect(document.documentElement.lang).toBe("de-DE");
    // The map's object names follow: Material master reads Materialstamm.
    await waitFor(() => expect(screen.getByTestId("map")).toHaveTextContent("Materialstamm"));

    fireEvent.change(within(de).getByTestId("language-picker"), { target: { value: "ja" } });
    expect(readPrefs().locale).toBe("ja-JP");
    await waitFor(() => expect(screen.getByRole("navigation", { name: "移動先" })).toHaveTextContent("ランドスケープ"));
    expect(screen.getByTestId("map")).toHaveTextContent("品目マスタ");
    expect(within(screen.getByRole("dialog", { name: "環境設定" })).getByTestId("format-sample")).toHaveTextContent("2026年10月16日 05:17");

    fireEvent.change(within(screen.getByRole("dialog", { name: "環境設定" })).getByTestId("language-picker"), { target: { value: "en" } });
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Places" })).toHaveTextContent("Landscape"));
  });

  it("keeps the region when the language stays the same", async () => {
    setPreferences({ locale: "de-CH" });
    renderWithQuery(<V2Shell><h1>Page</h1></V2Shell>);
    const dialog = await screen.findByRole("dialog", { name: "Benutzereinstellungen" });
    expect(within(dialog).getByTestId("language-picker")).toHaveValue("de");
    fireEvent.change(within(dialog).getByTestId("language-picker"), { target: { value: "de" } });
    expect(readPrefs().locale).toBe("de-CH");
  });
});
