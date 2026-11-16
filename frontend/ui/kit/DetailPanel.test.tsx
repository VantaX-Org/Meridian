import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DetailPanel } from "./DetailPanel";

function Demo() {
  const [v, set] = useState("overview");
  return <DetailPanel idBase="d" label="Selected rule" header={<h2>MM003</h2>} tabsLabel="Rule detail" tabs={[{ id: "overview", label: "Overview" }, { id: "fix", label: "Fix" }]} value={v} onChange={set}><p>{v} body</p></DetailPanel>;
}

describe("DetailPanel", () => {
  it("switches the panel with the tabs", () => {
    render(<Demo />);
    expect(screen.getByText("overview body")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Fix" }));
    expect(screen.getByText("fix body")).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });
});
