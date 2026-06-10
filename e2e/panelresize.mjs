import { chromium } from "playwright-core";
import { URL, createBlankProject } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };
const leftWidth = (page) => page.locator(".esco-left").evaluate((el) => Math.round(el.getBoundingClientRect().width));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  // Start from a known width so the assertions are deterministic across runs.
  await page.evaluate(() => localStorage.setItem("esco.layout.leftWidth", "300"));
  await page.reload({ waitUntil: "networkidle" });
  await createBlankProject(page);

  const initial = await leftWidth(page);
  check("explorer starts at the default width", Math.abs(initial - 300) <= 4, `${initial}px`);
  check("a resize handle is present on the boundary", (await page.locator(".esco-resize-handle").count()) === 1);

  // Drag the splitter ~120px to the right.
  const box = await page.locator(".esco-resize-handle").boundingBox();
  const y = box.y + box.height / 2;
  const startX = box.x + box.width / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 120, y, { steps: 10 });
  await page.mouse.up();

  const widened = await leftWidth(page);
  check("dragging the splitter widens the explorer", widened > initial + 80, `${initial} → ${widened}`);

  // The CSS variable that drives the grid + decorative splitter tracks the width.
  const cssVar = await page.locator(".esco-body").evaluate((el) => getComputedStyle(el).getPropertyValue("--esco-left-width").trim());
  check("--esco-left-width tracks the dragged width", cssVar === `${widened}px`, cssVar);

  // The width survives a reload (persisted to localStorage).
  await page.reload({ waitUntil: "networkidle" });
  await createBlankProject(page);
  const afterReload = await leftWidth(page);
  check("the resized width persists across reload", Math.abs(afterReload - widened) <= 4, `${afterReload}px`);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
