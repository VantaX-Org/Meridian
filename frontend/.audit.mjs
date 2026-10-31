import { chromium } from "playwright";
import fs from "fs";
const exe = fs.readFileSync("/private/tmp/claude-501/pwchrome","utf8").trim();
const SP="/private/tmp/claude-501/-Users-reshigan/b152dc25-3228-4a8e-8ded-a9ddb9330cb6/scratchpad/audit";
fs.mkdirSync(SP,{recursive:true});
const pages = process.argv.slice(2);
const b = await chromium.launch({ executablePath: exe });
for (const w of [1440, 1280]) {
const ctx = await b.newContext({ viewport:{width:w,height:2400} });
await ctx.addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
await ctx.addInitScript(() => { try { localStorage.setItem("meridian:theme", "light"); } catch {} });
await ctx.route("**/api/v1/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
const p = await ctx.newPage();
for (const path of pages) {
  const name = path.replace(/[^a-z0-9]+/gi,"_").replace(/^_|_$/g,"") || "home";
  await p.goto(`http://localhost:3100${path}${path.includes("?")?"&":"?"}fixture=1&persona=lead`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  if (w===1440) await p.screenshot({ path: `${SP}/${name}.png` });
  const issues = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("svg") || el.closest(".m2-canvas-scroll-ignore")) continue;
      const cs = getComputedStyle(el);
      if (cs.display==="none"||cs.visibility==="hidden") continue;
      const txt = (el.innerText||"").trim();
      if (!txt || txt.length>80) continue;
      const clipX = el.scrollWidth > el.clientWidth + 1 && (cs.overflowX!=="visible"||cs.textOverflow==="ellipsis");
      const r = el.getBoundingClientRect(), pr = el.parentElement?.getBoundingClientRect();
      const spill = pr && el.children.length===0 && (r.right > pr.right + 2) && getComputedStyle(el.parentElement).overflowX==="visible";
      if ((clipX||spill) && r.width>0) out.push(`${clipX?"CLIP":"SPILL"} <${el.tagName.toLowerCase()} class="${el.className?.baseVal??el.className}"> "${txt.slice(0,50)}" w=${Math.round(r.width)}`);
    }
    return [...new Set(out)].slice(0,25);
  });
  console.log(`\n== ${w} ${path} (${issues.length})`); issues.forEach(i=>console.log("  "+i));
}
await ctx.close();
}
await b.close();
