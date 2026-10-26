import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import { RunAnalysis } from "../RunAnalysis";

let granted = new Set<string>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => granted.has(a) }) }));
vi.mock("@/app/(app)/systems/[systemId]/scope-picker", () => ({ ScopePicker: () => null }));

async function openWithNoSystems() {
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
  renderWithQuery(<RunAnalysis />);
  fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
  const drawer = await screen.findByRole("dialog");
  await within(drawer).findByText(/No SAP system is connected yet/);
  return drawer;
}

describe("RunAnalysis with no system connected", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("links to connect a system when the role may manage systems", async () => {
    granted = new Set(["trigger_sync", "manage_systems", "upload"]);
    const drawer = await openWithNoSystems();
    expect(within(drawer).getByRole("link", { name: "Connect a system" })).toHaveAttribute("href", "/systems?connect=1");
    expect(within(drawer).getByRole("link", { name: "import a file" })).toHaveAttribute("href", "/import");
  });

  it("offers only the import to a role that may upload but not manage systems", async () => {
    granted = new Set(["trigger_sync", "upload"]);
    const drawer = await openWithNoSystems();
    expect(within(drawer).queryByRole("link", { name: /connect a system/i })).toBeNull();
    expect(within(drawer).getByRole("link", { name: "Import a file" })).toHaveAttribute("href", "/import");
  });

  it("says whom to ask when the role may do neither", async () => {
    granted = new Set(["trigger_sync"]);
    const drawer = await openWithNoSystems();
    expect(within(drawer).queryAllByRole("link")).toHaveLength(0);
    expect(within(drawer).getByText(/Ask an administrator to connect one/)).toBeInTheDocument();
  });
});
