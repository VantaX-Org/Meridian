import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import RuleDetailRedirect from "../page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ object: "material_master", ruleId: "mm_missing_desc" }),
  useSearchParams: () => new URLSearchParams("run=v1"),
  useRouter: () => ({ replace }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("RuleDetailRedirect", () => {
  it("redirects to the object page's records tab, preserving run", async () => {
    renderWithQuery(<RuleDetailRedirect />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/objects/material_master?run=v1&tab=records&check_id=mm_missing_desc"),
    );
  });
});
