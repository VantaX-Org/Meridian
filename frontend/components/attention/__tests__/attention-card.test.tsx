import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/attention";
import { AttentionCard } from "../attention-card";
import { SAMPLE, item, listOf } from "./fixtures";

beforeEach(() => vi.restoreAllMocks());

describe("AttentionCard", () => {
  it("shows a skeleton until the list arrives, never an empty line first", async () => {
    let resolve: (v: api.AttentionList) => void = () => {};
    vi.spyOn(api, "getAttention").mockReturnValue(new Promise((r) => { resolve = r; }));
    renderWithQuery(<AttentionCard />);
    expect(screen.getByTestId("attention-loading")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing in your scope/)).toBeNull();
    resolve(listOf(SAMPLE));
    expect(await screen.findByTestId("attention-card")).toBeInTheDocument();
    expect(screen.queryByTestId("attention-loading")).toBeNull();
  });

  it("lists the top five with each action, in the order returned, and All N opens the page", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue({ ...listOf(SAMPLE), counts: { critical: 1, high: 3, medium: 1, low: 1 } });
    renderWithQuery(<AttentionCard />);
    const rows = await screen.findAllByTestId("attention-row");
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByText("KSA PRD cannot be reached")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("link", { name: "Open system: KSA PRD cannot be reached" })).toHaveAttribute("href", "/systems/s1");
    expect(within(rows[1]).getByRole("link", { name: /^Review:/ })).toHaveAttribute("href", "/fix?module=material_master&st=to_fix");
    const all = screen.getByRole("link", { name: "All 6 to-do items" });
    expect(all).toHaveAttribute("href", "/attention");
    expect(all).toHaveTextContent("All 6");
    expect(api.getAttention).toHaveBeenCalledWith({ limit: 5 });
  });

  it("asks for one object and keeps the object filter on the page link", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf([SAMPLE[1]]));
    renderWithQuery(<AttentionCard object="material_master" />);
    expect(await screen.findByTestId("attention-card")).toBeInTheDocument();
    expect(api.getAttention).toHaveBeenCalledWith({ limit: 5, object: "material_master" });
    expect(screen.getByRole("link", { name: "All 1 to-do items" })).toHaveAttribute("href", "/attention?object=material_master");
    // The object is the page's, so the row does not repeat it.
    expect(screen.queryByText("Material master")).toBeNull();
  });

  it("says nothing is waiting on a home, and stays out of an object page, once the list is empty", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf([]));
    const home = renderWithQuery(<AttentionCard />);
    expect(await screen.findByText("Nothing in your scope needs a person now")).toBeInTheDocument();
    home.unmount();
    const obj = renderWithQuery(<AttentionCard object="fi_gl" />);
    await waitFor(() => expect(screen.queryByTestId("attention-loading")).toBeNull());
    expect(obj.container.querySelector("section")).toBeNull();
  });

  it("renders nothing when the list cannot be read", async () => {
    vi.spyOn(api, "getAttention").mockRejectedValue(new Error("down"));
    const { container } = renderWithQuery(<AttentionCard />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
    expect(screen.queryByText(/Nothing in your scope/)).toBeNull();
  });

  it("has no title that is a status verdict", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue(listOf([item()]));
    renderWithQuery(<AttentionCard />);
    expect(await screen.findByRole("heading", { name: "To do" })).toBeInTheDocument();
  });
});
