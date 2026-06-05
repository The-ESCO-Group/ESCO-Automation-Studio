// E2E: geometry guards for the HMI designer/operator layout at constrained
// viewports. The other HMI drivers assert content presence; this one asserts
// the layout does not wrap or overlap when the designer is hosted inside the
// narrow IDE center pane (the 1366/1440 case that regressed before).
import { chromium } from "playwright-core";
import { URL, createBlankProject, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + detail : ""}`);
};

const VIEWPORTS = [
  { w: 1366, h: 768 },
  { w: 1440, h: 960 },
  { w: 1920, h: 1080 },
];

const browser = await chromium.launch({ channel: "msedge", headless: true });

async function openDesignerWithScreen(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-controller-organizer").waitFor({ timeout: 60000 });
  await createBlankProject(page);
  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("HMI Designer")').click();
  if ((await page.locator('button:has-text("Enable HMI Project")').count()) > 0) {
    await page.locator('button:has-text("Enable HMI Project")').click();
  }
  await page.locator('[data-testid="hmi-designer"]').waitFor({ timeout: 8000 });
  await page.locator('input[aria-label="New HMI screen name"]').fill("Overview");
  await page
    .locator(".esco-hmi-create")
    .filter({ has: page.locator('input[aria-label="New HMI screen name"]') })
    .locator("button")
    .click();
  await page.locator('.esco-hmi-nav button:has-text("Overview")').first().waitFor({ timeout: 5000 });
  await dismissToasts(page);
}

try {
  for (const v of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: v.w, height: v.h } });
    page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
    await openDesignerWithScreen(page);

    // 1. Canvas toolbar must stay on a single line (no 3-line wrap stack).
    const toolbar = await page.evaluate(() => {
      const tb = document.querySelector(".esco-hmi-canvas__toolbar");
      if (!tb) return null;
      const r = tb.getBoundingClientRect();
      const wrapped = [...tb.children].some((c) => {
        if (c.tagName === "BUTTON" || !(c.textContent || "").trim()) return false;
        const lh = parseFloat(getComputedStyle(c).lineHeight) || 16;
        return c.getBoundingClientRect().height > lh * 1.6;
      });
      return { h: Math.round(r.height), wrapped };
    });
    check(`[${v.w}] Canvas toolbar stays single-line`, toolbar && !toolbar.wrapped && toolbar.h <= 44, `h=${toolbar?.h}`);

    // 2. Preview button reachable (a real control, must be clickable).
    const previewBtn = page.locator('[data-testid="hmi-start-preview"]');
    check(`[${v.w}] Preview control is visible`, await previewBtn.isVisible());

    // Enter operator runtime.
    await previewBtn.click();
    await page.locator('[data-testid="hmi-operator-runtime"]').waitFor({ timeout: 8000 });

    const op = await page.evaluate(() => {
      const rect = (s) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
      };
      const status = (() => {
        const e = document.querySelector(".esco-hmi-operator__status");
        if (!e) return { wrapped: true };
        const lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
        // any chip taller than ~1.6 lines means it broke mid-text
        const chipWrapped = [...e.children].some((c) => c.getBoundingClientRect().height > lh * 1.6);
        return { wrapped: chipWrapped };
      })();
      const stack = rect(".esco-hmi-operator__process-stack");
      const mimic = rect(".esco-hmi-operator__mimic");
      const controls = rect(".esco-hmi-operator__controls");
      const overlap = (a, b) => a && b && !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
      return {
        statusWrapped: status.wrapped,
        stackH: stack ? Math.round(stack.h) : 0,
        mimicControlsOverlap: overlap(mimic, controls),
      };
    });
    check(`[${v.w}] Operator status bar stays single-line`, !op.statusWrapped);
    check(`[${v.w}] Process stack is not collapsed`, op.stackH >= 240, `h=${op.stackH}`);
    check(`[${v.w}] Mimic does not overlap operator controls`, !op.mimicControlsOverlap);

    await page.close();
  }

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
