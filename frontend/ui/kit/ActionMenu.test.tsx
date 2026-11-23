import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu } from "./ActionMenu";
import { PageHeader } from "./PageHeader";

describe("ActionMenu", () => {
  it("opens, runs an item and closes", () => {
    const go = vi.fn();
    render(<ActionMenu label="More" items={[{ id: "a", label: "Do it", onClick: go }]} />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Do it" }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("closes on Escape and keeps disabled items inert", () => {
    const go = vi.fn();
    render(<ActionMenu label="More" items={[{ id: "a", label: "Nope", onClick: go, disabled: true }]} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Nope" }));
    expect(go).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("PageHeader back link", () => {
  it("links to the parent screen", () => {
    render(<PageHeader title="Child" back={{ href: "/parent", label: "Back to parent" }} />);
    expect(screen.getByRole("link", { name: "Back to parent" }).getAttribute("href")).toBe("/parent");
  });
  it("shows no link without a back target", () => {
    render(<PageHeader title="Child" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
