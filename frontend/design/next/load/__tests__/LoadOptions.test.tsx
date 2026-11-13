import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_LOAD, LoadOptions, loadOptionsProblem, toLoadOptions, type LoadChoice } from "../LoadOptions";

function Host({ onValue }: { onValue?: (v: LoadChoice) => void }) {
  const [v, setV] = useState<LoadChoice>(DEFAULT_LOAD);
  return <LoadOptions value={v} onChange={(n) => { setV(n); onValue?.(n); }} />;
}

describe("load options", () => {
  it("full needs no date, incremental does", () => {
    expect(loadOptionsProblem(DEFAULT_LOAD)).toBeNull();
    expect(loadOptionsProblem({ ...DEFAULT_LOAD, load_mode: "incremental" })).toMatch(/Pick the date/);
    expect(loadOptionsProblem({ ...DEFAULT_LOAD, load_mode: "incremental", since: "2026-01-01" })).toBeNull();
  });

  it("maps the choice to the API parameters", () => {
    expect(toLoadOptions(DEFAULT_LOAD)).toEqual({ load_mode: "full", since: null });
    expect(toLoadOptions({ load_mode: "full", since: "2026-01-01", all_entities: false }).since).toBeNull();
    expect(toLoadOptions({ load_mode: "incremental", since: "2026-01-01", all_entities: true })).toEqual({ load_mode: "incremental", since: "2026-01-01" });
  });

  it("explains each mode, shows the date only for incremental and reports changes", () => {
    const seen = vi.fn();
    render(<Host onValue={seen} />);
    expect(screen.getByText(/Full load: the file replaces/)).toBeTruthy();
    expect(screen.queryByLabelText("Changed on or after")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Incremental load" }));
    expect(screen.getByText(/Incremental load: the file carries only rows/)).toBeTruthy();
    expect(screen.getByText(/Pick the date/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Changed on or after"), { target: { value: "2026-03-01" } });
    expect(seen).toHaveBeenLastCalledWith({ load_mode: "incremental", since: "2026-03-01", all_entities: false });
  });

  it("says what the all-entities switch includes", () => {
    const seen = vi.fn();
    render(<Host onValue={seen} />);
    expect(screen.getByText(/Adds every SuccessFactors entity/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Include every entity/ }));
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ all_entities: true }));
  });
});
