import { fireEvent, screen } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { ConfigComparePanel } from "../config-compare-panel";
import * as pairingApi from "@/lib/api/config-pairing";
import type { ConfigCompare } from "@/lib/api/config-pairing";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/systems/sys1",
  useSearchParams: () => new URLSearchParams(),
}));

const compare = (over: Partial<ConfigCompare> = {}): ConfigCompare => ({
  source_load_id: "l1",
  target: { system_id: null, label: "baseline target", baseline: true },
  objects: [{ object: "T077K", exists: 3, key_match: 1, desc_match: 0, missing: 2, proposable: 1 }],
  rows: [],
  ...over,
});

describe("ConfigComparePanel", () => {
  it("shows the baseline target and per-object counts", async () => {
    vi.spyOn(pairingApi, "getConfigCompare").mockResolvedValue(compare());
    renderWithQuery(<ConfigComparePanel systemId="sys1" canPropose />);
    expect(await screen.findByText(/Compared with baseline target/)).toBeInTheDocument();
    expect(screen.getByText(/SAP standard baseline/)).toBeInTheDocument();
    expect(screen.getByText("T077K")).toBeInTheDocument();
  });

  it("proposes matches and reports the count", async () => {
    vi.spyOn(pairingApi, "getConfigCompare").mockResolvedValue(compare());
    const propose = vi.spyOn(pairingApi, "proposeConfigMatches").mockResolvedValue({ proposed: 1, skipped: 0, target: "S4D" });
    renderWithQuery(<ConfigComparePanel systemId="sys1" canPropose />);
    fireEvent.click(await screen.findByRole("button", { name: "Propose matches" }));
    await vi.waitFor(() => expect(propose).toHaveBeenCalledWith("sys1"));
  });

  it("explains when the source has no configuration yet", async () => {
    vi.spyOn(pairingApi, "getConfigCompare").mockResolvedValue(compare({ source_load_id: null, objects: [] }));
    renderWithQuery(<ConfigComparePanel systemId="sys1" canPropose={false} />);
    expect(await screen.findByText("Load this system's configuration to compare it with its target.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose matches" })).toBeNull();
  });

  it("treats a 404 as no configuration and shows the error state for other failures", async () => {
    const nf = new AxiosError("nf", "ERR_BAD_REQUEST", undefined, undefined, { status: 404 } as AxiosResponse);
    vi.spyOn(pairingApi, "getConfigCompare").mockRejectedValueOnce(nf);
    const { unmount } = renderWithQuery(<ConfigComparePanel systemId="sys1" canPropose />);
    expect(await screen.findByText("Load this system's configuration to compare it with its target.")).toBeInTheDocument();
    unmount();
    vi.spyOn(pairingApi, "getConfigCompare").mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(<ConfigComparePanel systemId="sys2" canPropose />);
    expect(await screen.findByText(/The comparison could not be read\. Could not reach the server\./)).toBeInTheDocument();
  });
});
