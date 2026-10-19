import { RECORDED, test } from "./fixtures";
const OUT = "/tmp/claude-0/-home-user-Meridian/245ddd26-4c60-5af4-9eae-3e495fe6a135/scratchpad/shots2";
const PAGES: [string, string][] = [["home", "/home"], ["insights", "/insights"], ["objects", "/objects"], ["object", `/objects/material_master?run=${RECORDED.materialRunId}`], ["glossary", "/mdm/glossary"]];
for (const [name, path] of PAGES) {
  test(`${name}`, async ({ app }) => {
    await app.addInitScript(() => window.localStorage.setItem("meridian:theme", "light"));
    await app.route("**/api/v1/me/preferences", (r) => r.request().method() === "GET" ? r.fulfill({ json: { theme: "light", density: "default" } }) : r.fallback());
    await app.setViewportSize({ width: 1440, height: 900 });
    await app.goto(path);
    await app.waitForLoadState("networkidle");
    await app.waitForTimeout(1200);
    if (name === "glossary") await app.getByRole("button", { name: "More" }).click();
    await app.screenshot({ path: `${OUT}/${name}.png` });
  });
}
