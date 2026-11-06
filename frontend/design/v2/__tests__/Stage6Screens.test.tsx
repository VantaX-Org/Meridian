import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { Atlas } from "../screens/Atlas";
import { Config } from "../screens/Config";
import { EntryGate } from "../screens/EntryGate";
import { MdmHealth } from "../screens/MdmHealth";
import { Mining } from "../screens/Mining";
import { S4Readiness } from "../screens/S4Readiness";
import { FlightDeck } from "../screens/FlightDeck";
import { Forecast } from "../screens/Forecast";
import { Insights } from "../screens/Insights";
import { Issues } from "../screens/Issues";
import { Links } from "../screens/Links";
import { Material } from "../screens/Material";
import { ProcessDiscovery } from "../screens/ProcessDiscovery";
import { ReferenceData } from "../screens/ReferenceData";
import { ScoreLens } from "../screens/ScoreLens";
import { Value } from "../screens/Value";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  undo = stubLayout();
  setUrl("/");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const screens = { EntryGate, MdmHealth, Mining, S4Readiness, Atlas, Config, FlightDeck, Forecast, Insights, Issues, Links, Material, ProcessDiscovery, ReferenceData, ScoreLens, Value };

describe("stage 6 screens open with a guide", () => {
  for (const [name, C] of Object.entries(screens)) {
    it(`${name} says what it shows, offers one next step and defines its figures`, async () => {
      renderWithQuery(<C />);
      const g = await screen.findByTestId("guide", undefined, { timeout: 8000 });
      expect(g.querySelectorAll(".m2-strong").length).toBeLessThanOrEqual(1);
      expect(g.querySelectorAll("dt").length).toBeGreaterThan(0);
    });
  }
});
