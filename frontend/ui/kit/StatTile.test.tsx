import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("shows label, value and note", () => {
    render(<dl><StatTile label="Records failing" value="1.2k" note="of 8k checked" bar={15} barTone="pass" /></dl>);
    expect(screen.getByText("Records failing")).toBeTruthy();
    expect(screen.getByText("1.2k")).toBeTruthy();
    expect(screen.getByText("of 8k checked")).toBeTruthy();
  });
});
