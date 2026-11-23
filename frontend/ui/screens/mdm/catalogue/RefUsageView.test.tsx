import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import * as ref from "@/lib/api/v2/reference-data";
import { RefUsageView } from "./RefUsageView";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/v2/reference-data", async (orig) => ({ ...(await orig<typeof ref>()), getRefUsage: vi.fn() }));

const real = await vi.importActual<typeof ref>("@/lib/api/v2/reference-data");
const ECC = "a1b2c3d4-0001-4000-8000-000000000001";
const source = [{ code: "DE", text: "Germany" }, { code: "ZA", text: "South Africa" }, { code: "FR", text: "France" }];

beforeEach(() => {
  stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/x?fixture=1");
  vi.mocked(ref.getRefUsage).mockReset().mockImplementation(real.getRefUsage);
});

describe("RefUsageView", () => {
  it("shows the valid share, orphan values and unused codes with text", async () => {
    renderWithQuery(<RefUsageView systemId={ECC} listId="country" source={source} />);
    expect(await screen.findByRole("group", { name: "Values not in the list" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Valid share by field" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Target fields" })).toBeTruthy();
    expect(screen.getByText("XX")).toBeTruthy();
    expect(document.body.textContent).not.toContain(String.fromCharCode(0xb7));
  });
  it("shows an empty state when no run profiled the fields", async () => {
    const u = await real.getRefUsage(ECC, "country");
    vi.mocked(ref.getRefUsage).mockResolvedValueOnce({ ...u, version_id: null });
    renderWithQuery(<RefUsageView systemId={ECC} listId="country" source={source} />);
    expect(await screen.findByText("No analysis run has profiled these fields")).toBeTruthy();
  });
  it("shows an error and retries", async () => {
    vi.mocked(ref.getRefUsage).mockRejectedValueOnce(new Error("down"));
    renderWithQuery(<RefUsageView systemId={ECC} listId="country" source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("group", { name: "Target fields" })).toBeTruthy();
  });
});
