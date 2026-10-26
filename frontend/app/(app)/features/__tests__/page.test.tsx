import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { LEGACY_PERMISSIONS } from "@/e2e/fixtures/legacy-permissions";
import { FEATURE_AREAS, featureIndex, resolveNavHref } from "@/lib/nav";
import { resourceMatrix } from "@/lib/rbac";

const actions: readonly string[] = LEGACY_PERMISSIONS.admin;
const matrix = resourceMatrix(actions);
const gate = { can: (a: string) => actions.includes(a), isMenuItemEnabled: () => true, has: (r: string, a: string) => matrix[r]?.[a] === true };

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: gate.can, loading: false, homeRole: "platform_admin" }) }));
vi.mock("@/hooks/use-nav", () => ({ useNavGate: () => gate }));
vi.mock("@/app/(app)/insights/_components/RunAnalysis", () => ({ RunAnalysis: () => <button type="button">Run analysis</button> }));

import AllFeaturesPage from "../page";

describe("All features", () => {
  it("shows an admin every nav page, by area, with what you do there, and every way to start a run", () => {
    renderWithQuery(<AllFeaturesPage />);
    const areas = featureIndex(gate, (h) => resolveNavHref(h, "platform_admin"));
    expect(areas.map((a) => a.area)).toEqual([...FEATURE_AREAS]);
    for (const { area, items } of areas) {
      const list = screen.getByRole("list", { name: area });
      for (const item of items) {
        const link = within(list).getByRole("link", { name: item.label });
        expect(link).toHaveAttribute("href", item.href);
        expect(within(list).getByText(item.description)).toBeInTheDocument();
      }
    }
    expect(screen.getByRole("button", { name: "Run analysis" })).toBeInTheDocument();
    for (const name of ["Import a file", "Extract from a system", "Run process discovery", "Invite a user"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });
});
