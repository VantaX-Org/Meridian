import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fixtureActive, fixtureAllowed } from "@/lib/api/v2/fixture";
import { DemoBar } from "../shell/DemoBar";
import { StandaloneRoot } from "../shell/Standalone";

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});

describe("fixture mode gate", () => {
  it("development and test builds may answer from fixtures", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_MERIDIAN_DEMO", "");
    expect(fixtureAllowed()).toBe(true);
    window.history.pushState({}, "", "/?fixture=1");
    expect(fixtureActive()).toBe(true);
  });

  it("a production build ignores ?fixture=1 and a stored flag unless it was built for a demo", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_MERIDIAN_DEMO", "");
    expect(fixtureAllowed()).toBe(false);
    window.history.pushState({}, "", "/?fixture=1");
    expect(fixtureActive()).toBe(false);
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    window.history.pushState({}, "", "/work");
    expect(fixtureActive()).toBe(false);
  });

  it("a production build made with NEXT_PUBLIC_MERIDIAN_DEMO=1 allows it", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_MERIDIAN_DEMO", "1");
    expect(fixtureAllowed()).toBe(true);
    window.history.pushState({}, "", "/?fixture=1");
    expect(fixtureActive()).toBe(true);
    window.history.pushState({}, "", "/work");
    expect(fixtureActive()).toBe(true);
  });
});

describe("demo data bar", () => {
  it("shows on a page in fixture mode and says the figures are sample data", async () => {
    window.history.pushState({}, "", "/status?fixture=1");
    render(<StandaloneRoot><h1>Status</h1></StandaloneRoot>);
    const bar = await screen.findByTestId("demo-bar");
    expect(bar).toHaveAttribute("role", "status");
    expect(bar).toHaveTextContent("Demo data");
    expect(bar).toHaveTextContent("not read from your SAP systems");
  });

  it("is absent when fixture mode is off", () => {
    window.history.pushState({}, "", "/status");
    render(<StandaloneRoot><h1>Status</h1></StandaloneRoot>);
    expect(screen.queryByTestId("demo-bar")).toBeNull();
  });

  it("is absent on a production build without the demo flag even with ?fixture=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_MERIDIAN_DEMO", "");
    window.history.pushState({}, "", "/status?fixture=1");
    render(<DemoBar />);
    expect(screen.queryByTestId("demo-bar")).toBeNull();
  });
});
