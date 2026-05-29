import { chromium } from "playwright-core";
import { URL, importStarterProject } from "./helpers.mjs";

const results = [];
const check = (l, c, d = "") => {
  results.push(!!c);
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`);
};
const tab = (page, name) => page.locator(`.esco-dock__tab:has-text("${name}")`);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await importStarterProject(page);

  // Status bar shows Offline Simulation by default — never "Connected".
  const statusConn = await page.locator(".esco-statusbar__connection").innerText();
  check("status bar shows Offline Simulation by default", /Offline Simulation/i.test(statusConn), statusConn);
  check("status bar does NOT claim Connected", !/Connected/i.test(statusConn));

  // Open the Controller dock tab.
  await tab(page, "Controller").click();
  await page.locator(".esco-controller").waitFor({ timeout: 5000 });
  const badge = await page.locator(".esco-conn-badge").first().innerText();
  check("controller panel badge shows Offline Simulation", /Offline Simulation/i.test(badge), badge);

  // The three guarded commands are visible but blocked (disabled) with a reason.
  const blockedPills = await page.locator(".esco-pill--blocked").count();
  check("upload/download/online-edit are all shown as Blocked", blockedPills === 3, `pills=${blockedPills}`);

  const downloadBtn = page
    .locator(".esco-controller__cmd:has-text('Download to Controller') button.esco-btn--primary")
    .first();
  check("Download button is visible", (await downloadBtn.count()) === 1);
  check("Download button is disabled (blocked)", await downloadBtn.isDisabled());

  const onlineEditBtn = page
    .locator(".esco-controller__cmd:has-text('Online Edit') button.esco-btn--primary")
    .first();
  check("Online Edit button is disabled (blocked)", await onlineEditBtn.isDisabled());

  const panelText = await page.locator(".esco-controller").innerText();
  check("panel states there is no tested controller transport", /no tested controller transport/i.test(panelText));

  // Attempt a real read-only connection → must land in Safety Blocked, never Connected.
  await page.locator("button:has-text('Request Read-Only')").click();
  await page.waitForFunction(
    () => /Safety Blocked/i.test(document.querySelector(".esco-conn-badge")?.textContent ?? ""),
    { timeout: 5000 },
  );
  const afterRequest = await page.locator(".esco-conn-badge").first().innerText();
  check("requesting a real read-only link results in Safety Blocked", /Safety Blocked/i.test(afterRequest), afterRequest);
  check("real connection attempt never shows Connected", !/Connected/i.test(afterRequest));

  // The audit log recorded the attempt.
  const auditText = await page.locator(".esco-controller__audit").innerText();
  check("connection audit records the go-online attempt", /go-online|state-change/i.test(auditText));

  // Go back to offline simulation safely.
  await page.locator("button:has-text('Go Online (Simulation)')").click();
  await page.waitForFunction(
    () => /Offline Simulation/i.test(document.querySelector(".esco-conn-badge")?.textContent ?? ""),
    { timeout: 5000 },
  );
  const afterSim = await page.locator(".esco-conn-badge").first().innerText();
  check("Go Online (Simulation) returns to Offline Simulation", /Offline Simulation/i.test(afterSim), afterSim);

  // Even after all interactions, the status bar never claims a real connection.
  const finalStatus = await page.locator(".esco-statusbar__connection").innerText();
  check("status bar never shows Connected after interactions", !/Connected/i.test(finalStatus), finalStatus);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
