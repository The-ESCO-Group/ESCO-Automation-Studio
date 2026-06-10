// E2E: HMI designer full-screen pop-out toggle (Pop Out / Dock HMI).
import { chromium } from "playwright-core";
import { URL, createBlankProject, dismissToasts } from "./helpers.mjs";

const results = [];
const check = (label, condition, detail = "") => {
  results.push(!!condition);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + detail : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));

try {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-controller-organizer").waitFor({ timeout: 60000 });
  await createBlankProject(page);

  await page.locator('.esco-ribbon__tab:has-text("View")').click();
  await page.locator('.esco-ribbon-menu__item:has-text("HMI Designer")').click();
  if ((await page.locator('button:has-text("Enable HMI Project")').count()) > 0) {
    await page.locator('button:has-text("Enable HMI Project")').click();
  }
  await page.locator('[data-testid="hmi-designer"]').waitFor({ timeout: 8000 });
  await dismissToasts(page);

  const designer = page.locator('[data-testid="hmi-designer"]');
  const toggle = page.locator('[data-testid="hmi-popout-toggle"]');

  check("Pop-out toggle is visible in the HMI header", (await toggle.count()) === 1);
  check("Toggle starts unpressed and reads Pop Out", (await toggle.getAttribute("aria-pressed")) === "false" && /Pop Out/.test(await toggle.innerText()));
  check(
    "Designer starts docked (no pop-out modifier)",
    !(await designer.evaluate((node) => node.classList.contains("esco-hmi--popout"))),
  );

  await toggle.click();
  await page.waitForTimeout(200);
  check(
    "Clicking Pop Out applies the full-screen pop-out shell",
    await designer.evaluate((node) => node.classList.contains("esco-hmi--popout")),
  );
  check("Toggle is pressed and reads Dock HMI", (await toggle.getAttribute("aria-pressed")) === "true" && /Dock HMI/.test(await toggle.innerText()));
  const popoutBox = await designer.boundingBox();
  check(
    "Pop-out shell covers the viewport",
    popoutBox && popoutBox.x <= 1 && popoutBox.y <= 1 && popoutBox.width >= 1490 && popoutBox.height >= 970,
    popoutBox ? `${Math.round(popoutBox.width)}x${Math.round(popoutBox.height)} @ ${Math.round(popoutBox.x)},${Math.round(popoutBox.y)}` : "no box",
  );
  check(
    "Body scroll is locked while popped out",
    (await page.evaluate(() => document.body.style.overflow)) === "hidden",
  );

  // Designer remains functional while popped out: the project tree and props panel stay mounted.
  check(
    "Project tree stays available in pop-out",
    (await page.locator('[data-testid="hmi-project-tree"]').count()) === 1,
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check(
    "Escape returns the designer to docked mode",
    !(await designer.evaluate((node) => node.classList.contains("esco-hmi--popout"))),
  );
  check("Toggle resets after Escape", (await toggle.getAttribute("aria-pressed")) === "false");
  check(
    "Body scroll is restored after docking",
    (await page.evaluate(() => document.body.style.overflow)) !== "hidden",
  );

  await toggle.click();
  await page.waitForTimeout(150);
  await toggle.click();
  await page.waitForTimeout(150);
  check(
    "Toggle round-trips via click (pop out, dock)",
    !(await designer.evaluate((node) => node.classList.contains("esco-hmi--popout"))) &&
      (await toggle.getAttribute("aria-pressed")) === "false",
  );

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
