import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/mining";
import { ToastProvider } from "../../kit";
import { RecordMining } from "../RecordMining";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => true, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = (el: ReactElement) => renderWithQuery(<ToastProvider>{el}</ToastProvider>);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/mining");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Data mining", () => {
  it("shows the banner and every panel", async () => {
    wrap(<RecordMining />);
    expect(await screen.findByTestId("mining")).toBeInTheDocument();
    expect(screen.getByTestId("mining-run")).toBeInTheDocument();
    for (const id of ["mining-objects", "mining-patterns", "mining-duplicates", "mining-outliers", "mining-relationships"]) {
      expect(await screen.findByTestId(id)).toBeInTheDocument();
    }
  });

  it("shows empty states when mining found nothing", async () => {
    vi.spyOn(api, "getDuplicates").mockResolvedValue([]);
    vi.spyOn(api, "getAnomalies").mockResolvedValue([]);
    vi.spyOn(api, "getRelationships").mockResolvedValue([]);
    vi.spyOn(api, "getPatterns").mockResolvedValue({ patterns: [] });
    wrap(<RecordMining />);
    expect(await screen.findByText("Mining found no duplicate or outlier.")).toBeInTheDocument();
    expect(await screen.findByText("No likely duplicate was found.")).toBeInTheDocument();
    expect(await screen.findByText("No outlier was found.")).toBeInTheDocument();
    expect(await screen.findByText("No pattern was found.")).toBeInTheDocument();
    expect(await screen.findByText("No relationship between fields was found.")).toBeInTheDocument();
  });

  it("retries after an error", async () => {
    const spy = vi.spyOn(api, "getMiningOverview").mockRejectedValue(new Error("down"));
    wrap(<RecordMining />);
    expect(await screen.findByText("The mining figures could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    spy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("mining")).toBeInTheDocument();
  });
});
