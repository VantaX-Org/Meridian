import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Coded } from "@/design/v2/parts";
import { domTable, exportColumns, gridCsv, tableTitle, nodeDescription, nodeText, type ToolColumn } from "./grid-export";

type Row = { mtart: string; text: string; n: number };
const rows: Row[] = [{ mtart: "FERT", text: "Finished product", n: 3 }, { mtart: "ROH", text: "Raw material", n: 1200 }];
const cols: ToolColumn<Row>[] = [
  { id: "mtart", header: "Material type", cell: (r) => createElement(Coded, { code: r.mtart, text: r.text }) },
  { id: "n", header: "Records", cell: (r) => r.n, numeric: true },
];

describe("grid export of described codes", () => {
  it("reads the code from a Coded cell and its words separately", () => {
    const cell = createElement("span", null, createElement(Coded, { code: "FERT", text: "Finished product" }));
    expect(nodeText(cell)).toBe("FERT");
    expect(nodeDescription(cell)).toBe("Finished product");
    expect(nodeDescription(createElement(Coded, { code: "EA", text: "EA" }))).toBe("");
  });
  it("puts a description column beside each code column, and only there", () => {
    expect(exportColumns(rows, cols).map((c) => c.id)).toEqual(["mtart", "mtart__text", "n"]);
  });
  it("writes the CSV with the code and its description side by side", () => {
    expect(gridCsv(rows, cols).split("\n")).toEqual(["Material type,Material type description,Records", "FERT,Finished product,3", "ROH,Raw material,1200"]);
  });
  it("keeps a formula-looking value as text", () => {
    const bad: ToolColumn<{ v: string }>[] = [{ id: "v", header: "V", cell: (r) => r.v }];
    expect(gridCsv([{ v: "=HYPERLINK(1)" }], bad).split("\n")[1]).toBe("'=HYPERLINK(1)");
  });
});

describe("domTable", () => {
  it("reads what the table shows, codes with their words, numbers only in m2-num cells", () => {
    document.body.innerHTML = `<table><thead><tr><th></th><th>Plant</th><th>Type</th><th>Records</th></tr></thead><tbody>
      <tr><td><input type="checkbox"></td><td>0001</td><td><span class="m2-cd"><span class="m2-cdt">Finished product</span><code class="m2-cdc">FERT</code></span></td><td class="m2-num">1,200</td></tr>
      <tr hidden><td></td><td>9999</td><td>X</td><td class="m2-num">1</td></tr>
      <tr><td></td><td>0002</td><td>ROH</td><td class="m2-num">—</td></tr></tbody></table>`;
    const out = domTable(document.querySelector("table")!);
    expect(out.columns.map((c) => c.header)).toEqual(["Plant", "Type", "Type description", "Records"]);
    expect(out.rows).toEqual([
      { c1: "0001", c2: "FERT", c2__text: "Finished product", c3: 1200 },
      { c1: "0002", c2: "ROH", c2__text: null, c3: null },
    ]);
  });
});

describe("tableTitle", () => {
  it("names a table from its label, else the heading above it", () => {
    document.body.innerHTML = `<section><h2>Failing records</h2><div><div><table id="a"></table></div></div></section><table id="b" aria-label="Rules"></table>`;
    expect(tableTitle(document.getElementById("a") as HTMLTableElement)).toBe("Failing records");
    expect(tableTitle(document.getElementById("b") as HTMLTableElement)).toBe("Rules");
  });
});
