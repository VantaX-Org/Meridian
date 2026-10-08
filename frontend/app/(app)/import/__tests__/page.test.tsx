import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemsApi from "@/lib/api/systems";
import * as versionsApi from "@/lib/api/versions";
import type { Version } from "@/types/api";
import ImportPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const VERSION: Version = {
  id: "v1", run_at: "2026-01-01T00:00:00Z", label: null, status: "complete",
  dqs_summary: null, metadata: { modules: ["business_partner"], file_name: "vendors.csv", row_count: 10 },
} as Version;

describe("import page", () => {
  it("renders recent imports once loaded", async () => {
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [VERSION] });
    renderWithQuery(<ImportPage />);
    await waitFor(() => expect(screen.getByText("vendors.csv")).toBeInTheDocument());
  });

  it("shows an empty state when nothing has been imported", async () => {
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<ImportPage />);
    await waitFor(() => expect(screen.getByText(/Nothing imported yet/)).toBeInTheDocument());
  });
});
