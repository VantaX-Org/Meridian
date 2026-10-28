import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rolesApi from "@/lib/api/roles";
import { GrantDiff, grantDiffSentence } from "../grant-diff";

const EFFECTIVE = { role: "viewer", roles: [], actions: [], resources: {}, scopes: [], home: "/" };
const PREVIEW: rolesApi.GrantPreview = {
  before: EFFECTIVE, after: EFFECTIVE,
  diff: { added_actions: ["approve", "trigger_sync"], added_pairs: [["fixes", "approve"], ["extraction", "run"]], widened_scopes: [{ system_id: null, module: null }] },
};

beforeEach(() => vi.restoreAllMocks());

describe("grantDiffSentence", () => {
  it("names what the grant adds and where", () => {
    expect(grantDiffSentence(PREVIEW.diff, "every system")).toBe("Adds: approve fixes; run extraction on every system");
  });
  it("says when nothing is new", () => {
    expect(grantDiffSentence({ added_actions: [], added_pairs: [], widened_scopes: [] }, "every system")).toBe("Adds nothing new. This person already has all of this access.");
  });
  it("shortens a long list", () => {
    const pairs: [string, string][] = ["systems", "rules", "findings", "fixes", "mdm", "glossary", "reports", "audit"].map((r) => [r, "view"]);
    const s = grantDiffSentence({ added_actions: [], added_pairs: pairs, widened_scopes: [] }, "ECC prod");
    expect(s).toMatch(/; and 2 more on ECC prod$/);
  });
});

describe("GrantDiff", () => {
  it("shows the diff from the API before anything is saved, and saves only on Save", async () => {
    const preview = vi.spyOn(rolesApi, "previewGrant").mockResolvedValue(PREVIEW);
    const onSave = vi.fn(), onClose = vi.fn();
    renderWithQuery(<GrantDiff userId="u1" grant={{ role_key: "data_steward", system_id: null, module: null }} systems={[]} saving={false} onSave={onSave} onClose={onClose} />);
    expect(await screen.findByTestId("grant-diff")).toHaveTextContent("Adds: approve fixes; run extraction on every system");
    expect(preview).toHaveBeenCalledWith("u1", { role_key: "data_steward", system_id: null, module: null });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save grant" }));
    expect(onSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("names the system the grant is scoped to", async () => {
    vi.spyOn(rolesApi, "previewGrant").mockResolvedValue(PREVIEW);
    renderWithQuery(<GrantDiff userId="u1" grant={{ role_key: "data_steward", system_id: "s1", module: "fi_gl" }} systems={[{ id: "s1", name: "ECC prod" }]} saving={false} onSave={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("grant-diff")).toHaveTextContent("on ECC prod / FI general ledger"));
  });

  it("keeps Save off until the preview has loaded", () => {
    vi.spyOn(rolesApi, "previewGrant").mockReturnValue(new Promise(() => {}));
    renderWithQuery(<GrantDiff userId="u1" grant={{ role_key: "viewer" }} systems={[]} saving={false} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save grant" })).toBeDisabled();
  });
});
