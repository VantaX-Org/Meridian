import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AletheiaProvider, ToastHost } from "@/ui/kit";

const m = vi.hoisted(() => ({ del: vi.fn() }));
vi.mock("@/lib/api/v2/roles", () => ({
  getComments: async () => ({ comments: [{ id: "c1", body: "hello", author_label: "Me", created_at: "2026-01-01T00:00:00Z", mine: true }] }),
  getMyWatches: async () => ({ watches: [] }),
  addComment: vi.fn(), putWatch: vi.fn(), deleteWatch: vi.fn(),
  deleteComment: m.del,
}));
import { CommentsPanel } from "./Comments";

describe("CommentsPanel", () => {
  it("shows the API sentence when a delete fails", async () => {
    m.del.mockRejectedValue(new Error("Not yours to delete"));
    renderWithQuery(<AletheiaProvider><ToastHost><CommentsPanel kind="contract" id="x" /></ToastHost></AletheiaProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByText("Not yours to delete")).toBeTruthy());
  });
});
