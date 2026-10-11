import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as simApi from "@/lib/api/simulation";
import * as versionsApi from "@/lib/api/versions";
import WhatIfPage from "../page";

vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissions: () => ({ can: () => true, has: () => true }),
  usePermissionsContext: () => null,
}));

function mount() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete" }] } as never);
  vi.spyOn(simApi, "createSimulation").mockResolvedValue({ simulation_id: "s1" } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><WhatIfPage /></QueryClientProvider>);
}

describe("WhatIfPage", () => {
  it("shows the worker error instead of crashing when a simulation fails", async () => {
    vi.spyOn(simApi, "getSimulation").mockResolvedValue({ simulation_id: "s1", status: "failed", error: "worker exploded" });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /run simulation/i }));
    expect(await screen.findByText("worker exploded")).toBeInTheDocument();
  });

  it("says the simulation expired when the lookup fails", async () => {
    vi.spyOn(simApi, "getSimulation").mockRejectedValue(new Error("404"));
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /run simulation/i }));
    expect(await screen.findByText(/has expired/i)).toBeInTheDocument();
  });
});
