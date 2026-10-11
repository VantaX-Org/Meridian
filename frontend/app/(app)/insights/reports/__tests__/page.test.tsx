import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as downloadApi from "@/lib/api/download";
import * as versionsApi from "@/lib/api/versions";
import ReportsPage from "../page";

const perm = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissions: () => ({ can: () => perm.allowed, has: () => perm.allowed }),
  usePermissionsContext: () => null,
}));

function mount() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v2", label: "Run 2", status: "complete" }] } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ReportsPage /></QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("ReportsPage", () => {
  it("lists the comparison report and downloads it for the chosen run", async () => {
    perm.allowed = true;
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    mount();
    expect(await screen.findByText("Run comparison")).toBeInTheDocument();
    await userEvent.click((await screen.findAllByRole("button", { name: "Download" }))[4]);
    expect(dl).toHaveBeenCalledWith(expect.stringContaining("compare.pdf?v2=v2"), "compare_v2.pdf");
  });

  it("shows no Download button without the export permission", async () => {
    perm.allowed = false;
    mount();
    expect(await screen.findByText("Run comparison")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.getAllByText(/needs the auditor or analyst role/i).length).toBeGreaterThan(0);
  });
});
