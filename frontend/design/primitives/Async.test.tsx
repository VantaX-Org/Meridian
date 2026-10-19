import { render, screen } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it, vi } from "vitest";
import { Async, asyncStateOf, type AsyncQuery } from "./Async";

const q = <T,>(over: Partial<AsyncQuery<T>>): AsyncQuery<T> => ({ isLoading: false, isError: false, error: null, data: undefined, ...over });
const http = (status: number) => new AxiosError("x", "ERR", undefined, undefined, { status, statusText: "", data: {}, headers: {}, config: { headers: new AxiosHeaders() } });

describe("asyncStateOf", () => {
  it("reads loading, error, empty and ready from a query", () => {
    expect(asyncStateOf(q({ isLoading: true }))).toBe("loading");
    expect(asyncStateOf(q({ isError: true, error: http(500) }))).toBe("error");
    expect(asyncStateOf(q({ data: [] as number[] }), (d) => d.length === 0)).toBe("empty");
    expect(asyncStateOf(q({ data: [1] }), (d) => d.length === 0)).toBe("ready");
  });
  it("reads a 404 as empty only for list endpoints", () => {
    expect(asyncStateOf(q({ isError: true, error: http(404) }))).toBe("error");
    expect(asyncStateOf(q({ isError: true, error: http(404) }), undefined, true)).toBe("empty");
  });
});

describe("Async", () => {
  it("shows the skeleton while loading", () => {
    const { container } = render(<Async query={q({ isLoading: true })} skeleton={120}>never</Async>);
    expect(container.querySelector("[data-state='loading']")).not.toBeNull();
    expect(screen.queryByText("never")).toBeNull();
  });
  it("shows apiErrorState's title and retries the query", () => {
    const refetch = vi.fn();
    render(<Async query={q({ isError: true, error: http(404), refetch })}>never</Async>);
    expect(screen.getByText("Not found.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(refetch).toHaveBeenCalled();
  });
  it("shows the empty copy, or the children when there is none", () => {
    render(<Async query={q({ data: [] as number[] })} isEmpty={(d) => d.length === 0} empty={{ title: "No rules yet" }}>never</Async>);
    expect(screen.getByText("No rules yet")).toBeInTheDocument();
    render(<Async state="empty">own empty line</Async>);
    expect(screen.getByText("own empty line")).toBeInTheDocument();
  });
  it("hands the data to a render function when ready", () => {
    render(<Async query={q({ data: { n: 3 } })}>{(d) => <span>{`n=${d.n}`}</span>}</Async>);
    expect(screen.getByText("n=3")).toBeInTheDocument();
  });
});
