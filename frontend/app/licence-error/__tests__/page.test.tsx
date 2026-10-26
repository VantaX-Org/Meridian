import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/licence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/licence")>()),
  getLicenceManifest: vi.fn().mockResolvedValue({ valid: false, status: "not_yet_checked", expiry_date: null, tenant_id: null }),
}));

import LicenceErrorPage from "../page";

describe("licence-error page", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("says Meridian HQ could not be reached when the API could not validate the licence", async () => {
    window.history.replaceState(null, "", "/licence-error?reason=licence_unverified");
    render(<LicenceErrorPage />);
    expect(await screen.findByText("Meridian HQ could not be reached to validate the licence")).toBeTruthy();
    expect(screen.queryByText("This licence is invalid or has expired")).toBeNull();
  });

  it("says the licence is invalid when HQ refused it", async () => {
    window.history.replaceState(null, "", "/licence-error?reason=licence_invalid");
    render(<LicenceErrorPage />);
    expect(await screen.findByText("This licence is invalid or has expired")).toBeTruthy();
  });
});
