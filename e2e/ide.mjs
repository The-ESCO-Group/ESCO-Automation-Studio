// E2E for the non-AI IDE shell: empty state, offline status, import, open routine,
// edit, Verify, Find, Copy/Paste, Compare, Tags, Forces, Data Monitor, and a New
// blank project (no demo auto-load, no fake logic). Offline-only. Honors E2E_URL.
import { chromium } from "playwright-core";

const URL = process.env.E2E_URL || "http://localhost:5173/";
const results = [];
const check = (label, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  - " + String(detail).replace(/\s+/g, " ").slice(0, 80) : ""}`);
};
const txt = async (p, s) => { try { return (await p.locator(s).first().innerText()).replace(/\s+/g, " ").trim(); } catch { return ""; } };
const cnt = async (p, s) => { try { return await p.locator(s).count(); } catch { return -1; } };
const ribbon = (p, label) => p.locator(`.esco-ribbon__button:has-text("${label}")`).first();

const L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0"><Controller Name="AuditCtrl">
 <Tags><Tag Name="Start" DataType="BOOL"/><Tag Name="Stop" DataType="BOOL"/><Tag Name="Run" DataType="BOOL"/></Tags>
 <Programs><Program Name="MainProgram" MainRoutineName="MainRoutine"><Routines>
  <Routine Name="MainRoutine" Type="RLL"><RLLContent>
   <Rung Number="0"><Text><![CDATA[XIC(Start)XIO(Stop)OTE(Run);]]></Text></Rung>
  </RLLContent></Routine></Routines></Program></Programs></Controller></RSLogix5000Content>`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("dialog", (d) => d.accept().catch(() => {})); // accept the dirty-close confirm

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // --- Empty state / no demo auto-load / offline status ---
  check("no demo auto-load (empty explorer)", /No controllers/i.test(await txt(page, ".esco-left")));
  const sb0 = await txt(page, ".esco-statusbar");
  check("status bar offline (not CONNECTED)", /DISCONNECTED|Offline/i.test(sb0) && !/\bCONNECTED\b/.test(sb0.replace(/DISCONNECTED/gi, "")), sb0);

  // --- Import a real L5X (fresh) ---
  let imported = false;
  const inputs = await cnt(page, 'input[type="file"]');
  for (let i = 0; i < inputs && !imported; i++) {
    try {
      await page.locator('input[type="file"]').nth(i).setInputFiles({ name: "audit.L5X", mimeType: "application/xml", buffer: Buffer.from(L5X) });
      await page.waitForTimeout(700);
      if (/AuditCtrl/.test(await txt(page, ".esco-left"))) imported = true;
    } catch {}
  }
  check("Import L5X loads a real project", imported);
  check("explorer shows controller + routine", /AuditCtrl/.test(await txt(page, ".esco-left")) && /MainRoutine/.test(await txt(page, ".esco-left")));
  check("status bar shows imported controller", /AuditCtrl/.test(await txt(page, ".esco-statusbar")), await txt(page, ".esco-statusbar"));

  // --- Routine open + ladder ---
  if ((await cnt(page, ".esco-lad__rung")) === 0) {
    try { await page.locator('.esco-left :text("MainRoutine")').first().click(); await page.waitForTimeout(400); } catch {}
  }
  check("ladder renders rungs", (await cnt(page, ".esco-lad__rung")) >= 1, `rungs=${await cnt(page, ".esco-lad__rung")}`);
  const beforeRungs = await cnt(page, ".esco-lad__rung");
  try { await page.locator('button:has-text("Add Rung")').first().click(); await page.waitForTimeout(300); } catch {}
  check("Add Rung works", (await cnt(page, ".esco-lad__rung")) === beforeRungs + 1);

  // --- Copy/Paste (Cut/Copy wired) ---
  try { await page.locator(".esco-lad__rung").first().click(); await page.waitForTimeout(150); } catch {}
  let copyDisabled = true; try { copyDisabled = await ribbon(page, "Copy").isDisabled(); } catch {}
  check("Copy enabled when a rung is selected", !copyDisabled);
  try { await ribbon(page, "Copy").click(); await page.waitForTimeout(150); } catch {}
  let pasteDisabled = true; try { pasteDisabled = await ribbon(page, "Paste").isDisabled(); } catch {}
  check("Paste enabled after Copy", !pasteDisabled);

  // --- Verify -> diagnostics ---
  try { await ribbon(page, "Verify").click(); await page.waitForTimeout(250); } catch {}
  check("Verify populates diagnostics", /(finding|valid|error|warning|message|no validation)/i.test(await txt(page, ".esco-dock")));

  // --- Find -> Search Results ---
  try { await ribbon(page, "Find").click(); await page.waitForTimeout(200); } catch {}
  check("Find opens Search Results panel", (await cnt(page, '.esco-search input[type="search"]')) === 1);
  try { await page.locator('.esco-search input[type="search"]').fill("Run"); await page.waitForTimeout(300); } catch {}
  check("Find returns results for a real term", (await cnt(page, ".esco-search table tbody tr")) >= 1, `rows=${await cnt(page, ".esco-search table tbody tr")}`);

  // --- Dock views (Forces / Data Monitor / Cross Reference change the dock) ---
  try { await ribbon(page, "Forces").click(); await page.waitForTimeout(150); } catch {}
  check("Forces opens forces panel", (await cnt(page, ".esco-forces")) >= 1);
  try { await ribbon(page, "Data Monitor").click(); await page.waitForTimeout(150); } catch {}
  check("Data Monitor opens watch", (await cnt(page, ".esco-watch")) >= 1);
  try { await ribbon(page, "Cross Reference").click(); await page.waitForTimeout(200); } catch {}
  check("Cross Reference opens references", /Reference/i.test(await txt(page, ".esco-dock__tab.is-active")), await txt(page, ".esco-dock__tab.is-active"));

  // --- Center views (Tags / Compare switch the center; test from routine view) ---
  const tagsBtns = page.getByRole("button", { name: "Tags", exact: true });
  const tagsCount = await tagsBtns.count();
  for (let i = 0; i < tagsCount; i++) {
    try { await tagsBtns.nth(i).click({ timeout: 3000 }); await page.waitForTimeout(300); } catch { continue; }
    if ((await cnt(page, ".esco-tags")) >= 1) break;
  }
  check("Tags opens tag table", (await cnt(page, ".esco-tags")) >= 1, await txt(page, ".esco-center, main"));
  try { await ribbon(page, "Compare").click(); await page.waitForTimeout(200); } catch {}
  check("Compare opens compare view", (await cnt(page, ".esco-cmp")) >= 1);

  // --- New blank project (no fake logic) — done last since it replaces state ---
  try { await ribbon(page, "New").click(); await page.waitForTimeout(400); } catch {}
  check("New creates a blank project", /Controller_1|MainRoutine/i.test(await txt(page, ".esco-statusbar")), await txt(page, ".esco-statusbar"));
  check("New project has no fake logic (0 rungs)", (await cnt(page, ".esco-lad__rung")) === 0, `rungs=${await cnt(page, ".esco-lad__rung")}`);

  // --- Close project -> honest empty state ---
  try { await page.locator('.esco-ribbon__button[title="Close the current project"]').first().click({ timeout: 3000 }); await page.waitForTimeout(300); } catch {}
  check("Close returns to empty 'No project' state", /No controllers/i.test(await txt(page, ".esco-left")), await txt(page, ".esco-statusbar"));

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
