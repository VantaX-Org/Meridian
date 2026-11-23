import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Stepper } from "./Stepper";
import { CycleStepper } from "./CycleStepper";

const steps = [{ id: "a", label: "Pull" }, { id: "b", label: "Clean" }, { id: "c", label: "Upload", state: "error" as const, hint: "Two rows rejected" }, { id: "d", label: "Score", state: "blocked" as const }];

describe("Stepper", () => {
  it("derives done, current and todo, and states each in words", () => {
    render(<Stepper label="Steps" steps={[{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }]} current={1} />);
    const items = screen.getAllByRole("list", { name: "Steps" })[0].querySelectorAll("li");
    expect([...items].map((li) => li.dataset.state)).toEqual(["done", "current", "todo"]);
    expect(items[1].getAttribute("aria-current")).toBe("step");
    expect(items[0].textContent).toContain("Completed");
    expect(items[2].textContent).toContain("Not started");
  });
  it("shows error and blocked with their own words and the hint", () => {
    render(<Stepper label="Steps" steps={steps} current={0} />);
    const li = screen.getAllByRole("list", { name: "Steps" })[0].querySelectorAll("li");
    expect(li[2].textContent).toContain("Failed");
    expect(li[2].textContent).toContain("Two rows rejected");
    expect(li[3].textContent).toContain("Blocked");
  });
  it("folds to a Step n of m line", () => {
    const { container } = render(<Stepper label="Steps" steps={steps} current={1} />);
    expect(container.querySelector("details summary")?.textContent).toContain("Step 2 of 4: Clean");
  });
  it("makes done steps clickable only when told", () => {
    const onStep = vi.fn();
    render(<Stepper label="Steps" steps={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} current={1} onStep={onStep} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^A/ })[0]);
    expect(onStep).toHaveBeenCalledWith("a");
    expect(screen.queryAllByRole("button", { name: /^B/ })[0]).toBeDefined();
  });
  it("CycleStepper passes states", () => {
    render(<CycleStepper label="Cycle" step="clean" states={{ upload: "error" }} labels={{ pull: "Pull", clean: "Clean", upload: "Upload", score: "Re-score", compare: "Compare" }} />);
    expect(screen.getAllByText(/Re-score/).length).toBeGreaterThan(0);
    expect(document.querySelector('li[data-state="error"]')).not.toBeNull();
  });
});
