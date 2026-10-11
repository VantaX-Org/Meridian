import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as licenceApi from "@/lib/api/licence";
import AdminSettingsPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => false }) }));
vi.mock("../alert-channels-panel", () => ({ AlertChannelsPanel: () => null }));

describe("AdminSettingsPage loading", () => {
  it("shows a skeleton while the licence loads", () => {
    vi.spyOn(licenceApi, "getLicenceManifest").mockReturnValue(new Promise(() => {}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={qc}><AdminSettingsPage /></QueryClientProvider>);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
