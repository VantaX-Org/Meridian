// Stewards land on Fix work (lib/persona.ts homeHrefForRole), so the first-run offer a persona home shows is here for them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "../../../../__tests__/render";
import FixPage from "../page";

const role = vi.hoisted(() => ({ homeRole: "steward" as string | undefined }));
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/fix",
  useSearchParams: () => searchParams,
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true, homeRole: role.homeRole }) }));
vi.mock("@/components/work/fix-work", () => ({ FixWork: () => null }));
vi.mock("@/components/help/home-onboarding", () => ({ HomeOnboarding: () => <div data-testid="home-onboarding" /> }));
vi.mock("../batches-tab", () => ({ BatchesTab: () => null }));
vi.mock("../monitor-dedup-tabs", () => ({ DedupTab: () => null }));

describe("Fix work onboarding", () => {
  beforeEach(() => { role.homeRole = "steward"; });

  it.each(["steward", "data_steward", "approver"])("offers the first-run row to the %s home role, whose landing page this is", (r) => {
    role.homeRole = r;
    renderWithQuery(<FixPage />);
    expect(screen.getByTestId("home-onboarding")).toBeInTheDocument();
  });

  it.each(["admin", "analyst", "sap_basis", "process_analyst"])("leaves it on the persona home for %s", (r) => {
    role.homeRole = r;
    renderWithQuery(<FixPage />);
    expect(screen.queryByTestId("home-onboarding")).toBeNull();
  });
});
