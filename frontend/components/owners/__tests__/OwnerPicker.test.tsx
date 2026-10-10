import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as ownersApi from "@/lib/api/owners";
import type { DataOwner } from "@/lib/api/owners";
import * as usersApi from "@/lib/api/users";
import { OwnerPicker } from "../OwnerPicker";

const ROW: DataOwner = {
  kind: "rule", ref: "AP001", owner_user_id: "u1", owner_name: "Ann", steward_user_id: null,
  steward_name: null, updated_at: "2026-10-10T08:00:00+00:00",
};

describe("OwnerPicker", () => {
  it("shows the owner as text when the viewer cannot assign", async () => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([ROW]);
    vi.spyOn(usersApi, "getAssignableUsers").mockRejectedValue(new Error("forbidden"));
    renderWithQuery(<OwnerPicker kind="rule" refId="AP001" />);
    await waitFor(() => expect(screen.getByText("Owner: Ann. Steward: not set.")).toBeInTheDocument());
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says when no owner is set", async () => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([{ ...ROW, ref: "AP002" }]);
    vi.spyOn(usersApi, "getAssignableUsers").mockRejectedValue(new Error("forbidden"));
    renderWithQuery(<OwnerPicker kind="rule" refId="AP001" />);
    await waitFor(() => expect(screen.getByText("No owner set.")).toBeInTheDocument());
  });

  it("saves the picked owner", async () => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([]);
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([
      { id: "u1", name: "Ann", email: "ann@example.test", role: "steward" },
    ]);
    const put = vi.spyOn(ownersApi, "putOwner").mockResolvedValue(ROW);
    renderWithQuery(<OwnerPicker kind="rule" refId="AP001" />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "Owner" }));
    const option = await screen.findByRole("option", { name: "Ann" });
    await waitFor(() => expect(option.closest("[role=listbox]")).toHaveAttribute("data-open"));
    await user.click(option);
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({ kind: "rule", ref: "AP001", owner_user_id: "u1", steward_user_id: null }),
    );
  });
});
