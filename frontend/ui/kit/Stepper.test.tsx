import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper } from "./Stepper";

describe("Stepper", () => {
  it("marks done, current and todo steps", () => {
    render(<Stepper label="Steps" current={1} steps={[{ id: "a", label: "Pull" }, { id: "b", label: "Clean" }, { id: "c", label: "Upload" }]} />);
    const li = screen.getAllByRole("listitem");
    expect(li.map((x) => x.getAttribute("data-state"))).toEqual(["done", "current", "todo"]);
    expect(li[1].getAttribute("aria-current")).toBe("step");
    expect(li.map((x) => x.querySelector(".mx-step-n")?.textContent)).toEqual(["\u2713", "2", "3"]);
  });
});
