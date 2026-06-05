import { chromium } from "playwright-core";
import { URL, dismissToasts, importL5XText, openMainRoutine, ribbonButton } from "./helpers.mjs";

const CONTROLLER_PATH_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="E2E_ControllerPath" ContentType="Controller">
  <Controller Use="Target" Name="E2E_ControllerPath" CommPath="AB_ETHIP-1\\192.168.1.10\\Backplane\\0" CommDriver="AB_ETHIP-1">
    <Tags>
      <Tag Name="StartPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="StopPB" TagType="Base" DataType="BOOL"/>
      <Tag Name="MotorRun" TagType="Base" DataType="BOOL"/>
    </Tags>
    <Programs>
      <Program Name="MainProgram" MainRoutineName="MainRoutine">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N"><Text><![CDATA[XIC(StartPB)XIO(StopPB)OTE(MotorRun);]]></Text></Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

const results = [];
const check = (l, c, d = "") => {
  results.push(!!c);
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`);
};
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

try {
  // The app's LiveBridge opens a retrying EventSource (MCP live stream), so the
  // network never goes idle — wait for the shell to mount instead of networkidle.
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator(".esco-ribbon").waitFor({ timeout: 60000 });
  await importL5XText(page, CONTROLLER_PATH_L5X, "controller-path.L5X");
  await openMainRoutine(page);
  await dismissToasts(page);

  // Status bar shows the offline/simulated state by default - never "Connected".
  const statusConn = await page.locator(".esco-statusbar__connection").innerText();
  check("status bar shows an offline/simulated state by default", /Online|Offline Simulation/i.test(statusConn), statusConn);
  check("status bar does NOT claim Connected", !/Connected/i.test(statusConn));

  check("Go Online is visible but guarded in the Studio toolbar", !(await ribbonButton(page, "Go Online").isDisabled()));
  check("Upload is visible but guarded in the Studio toolbar", !(await ribbonButton(page, "Upload").isDisabled()));
  check("Download is visible but guarded in the Studio toolbar", !(await ribbonButton(page, "Download").isDisabled()));

  await ribbonButton(page, "Go Online").click();
  await page.locator(".esco-controller").waitFor({ timeout: 5000 });
  await page.locator('[aria-label="Controller safety evidence"]').waitFor({ timeout: 5000 });
  const safetyEvidenceText = await page.locator('[aria-label="Controller safety evidence"]').innerText();
  check(
    "Controller panel shows aggregate hard-boundary safety evidence",
    /Controller Safety Evidence/.test(safetyEvidenceText) &&
      /0 verified physical/i.test(safetyEvidenceText) &&
      /Real transport gate\s+blocked/i.test(safetyEvidenceText) &&
      /Physical commands\s+\d+\/\d+ blocked/i.test(safetyEvidenceText) &&
      /Driver descriptors\s+0\/3 ready/i.test(safetyEvidenceText) &&
      /ESCO SoftController: verified-software/i.test(safetyEvidenceText) &&
      /offline-sim: offline-simulation/i.test(safetyEvidenceText) &&
      /unavailable: unconfigured/i.test(safetyEvidenceText) &&
      /model-only: unconfigured/i.test(safetyEvidenceText) &&
      /Physical PLC Forces: blocked/i.test(safetyEvidenceText) &&
      /Proprietary Binary Controller Files: blocked/i.test(safetyEvidenceText) &&
      /Pass - No verified physical transport ships/i.test(safetyEvidenceText),
    safetyEvidenceText,
  );
  await page.locator('[aria-label="Transport readiness"]').waitFor({ timeout: 5000 });
  const transportReadinessText = await page.locator('[aria-label="Transport readiness"]').innerText();
  check(
    "Controller panel shows transport readiness gates",
    /Transport Readiness \(3\)/.test(transportReadinessText) &&
      /Offline Simulation/.test(transportReadinessText) &&
      /Model-only Review/.test(transportReadinessText) &&
      /No Controller Transport/.test(transportReadinessText) &&
      /0 verified real/i.test(transportReadinessText) &&
      /no real transport/i.test(transportReadinessText),
    transportReadinessText,
  );
  await page.locator('[aria-label="Monitor state matrix"]').waitFor({ timeout: 5000 });
  const monitorMatrixText = await page.locator('[aria-label="Monitor state matrix"]').innerText();
  check(
    "Controller panel shows monitor/fault state readiness matrix",
    /Monitor State Matrix \(5\)/.test(monitorMatrixText) &&
      /Offline simulation/.test(monitorMatrixText) &&
      /Verified read-only harness/.test(monitorMatrixText) &&
      /Faulted read-only harness/.test(monitorMatrixText) &&
      /Unverified physical link/.test(monitorMatrixText) &&
      /do not select or create a physical controller transport/i.test(monitorMatrixText) &&
      /Download\s+blocked/.test(monitorMatrixText),
    monitorMatrixText,
  );
  await page.locator('[aria-label="Imported controller path diagnostics"]').waitFor({ timeout: 5000 });
  const pathDiagnosticsText = await page.locator('[aria-label="Imported controller path diagnostics"]').innerText();
  check(
    "Controller panel shows imported offline path diagnostics",
    /AB_ETHIP-1/.test(pathDiagnosticsText) &&
      /192\.168\.1\.10/.test(pathDiagnosticsText) &&
      /Backplane/.test(pathDiagnosticsText) &&
      /slot 0/i.test(pathDiagnosticsText) &&
      /no path browse/i.test(pathDiagnosticsText) &&
      /no online connection/i.test(pathDiagnosticsText),
    pathDiagnosticsText,
  );
  await page.locator('[aria-label="Online readiness"]').waitFor({ timeout: 5000 });
  const onlineReadinessText = await page.locator('[aria-label="Online readiness"]').innerText();
  check(
    "Controller panel shows an honest read-only online-readiness scaffold (not a live link)",
    /Online Readiness/.test(onlineReadinessText) &&
      /Offline readiness scaffold only/i.test(onlineReadinessText) &&
      /never that a controller is connected/i.test(onlineReadinessText) &&
      /read-only online is blocked because no verified physical transport ships/i.test(onlineReadinessText) &&
      /Real Controller/.test(onlineReadinessText),
    onlineReadinessText,
  );
  await page.locator('.esco-toast:has-text("Go Online is blocked")').waitFor({ timeout: 5000 });
  await page.locator(".esco-controller__audit tbody tr").first().waitFor({ timeout: 5000 });
  const onlineAuditText = await page.locator(".esco-controller__audit").innerText();
  check(
    "Go Online records safe unavailable/blocked audit rows",
    /go-online/.test(onlineAuditText) && /command-blocked/.test(onlineAuditText) && /No tested controller transport/i.test(onlineAuditText),
    onlineAuditText,
  );

  const beforeUploadAuditRows = await page.locator(".esco-controller__audit tbody tr").count();
  await ribbonButton(page, "Upload").click();
  await page.locator('.esco-toast:has-text("Upload from Controller is blocked")').waitFor({ timeout: 5000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-controller__audit tbody tr").length > count,
    beforeUploadAuditRows,
  );
  const uploadAuditText = await page.locator(".esco-controller__audit").innerText();
  check("Upload records a blocked command audit row", /Blocked Upload from Controller/.test(uploadAuditText), uploadAuditText);

  await page.locator('.esco-ribbon__tab:has-text("Communications")').click();
  const commsText = await page.locator('.esco-ribbon-menu[aria-label="Communications menu"]').innerText();
  check("Communications menu exposes blocked online actions", /Who Active/.test(commsText) && /Go Online/.test(commsText) && /Download/.test(commsText), commsText);
  check(
    "Communications menu keeps Go Online clickable but guarded",
    !(await page.getByRole("menuitem", { name: "Go Online (Unsupported)", exact: true }).isDisabled()),
  );

  const beforeDownloadAuditRows = await page.locator(".esco-controller__audit tbody tr").count();
  await page.getByRole("menuitem", { name: "Download... (Unsupported)", exact: true }).click();
  await page.locator('.esco-toast:has-text("Download to Controller is blocked")').waitFor({ timeout: 5000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-controller__audit tbody tr").length > count,
    beforeDownloadAuditRows,
  );
  const downloadAuditText = await page.locator(".esco-controller__audit").innerText();
  check("Download records a blocked command audit row", /Blocked Download to Controller/.test(downloadAuditText), downloadAuditText);

  await page.locator(".esco-tree__node--controller").first().click({ button: "right" });
  await page.locator(".esco-context-menu").waitFor({ timeout: 5000 });
  const controllerMenuText = await page.locator(".esco-context-menu").innerText();
  check(
    "controller organizer context exposes guarded session actions",
    /Go Online/.test(controllerMenuText) &&
      /Upload/.test(controllerMenuText) &&
      /Download/.test(controllerMenuText) &&
      /Who Active/.test(controllerMenuText),
    controllerMenuText,
  );
  const beforeNetworkAuditRows = await page.locator(".esco-controller__audit tbody tr").count();
  await page.locator('.esco-context-menu__item:has-text("Who Active")').click();
  await page.locator('.esco-toast:has-text("Who Active is blocked")').waitFor({ timeout: 5000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-controller__audit tbody tr").length > count,
    beforeNetworkAuditRows,
  );
  check(
    "Who Active from controller context records a blocked audit row",
    /Blocked Who Active/.test(await page.locator(".esco-controller__audit").innerText()),
  );

  // Rich per-command guard detail: risk badge + reason + exact required next step.
  const commandsText = await page.locator(".esco-controller__commands").innerText();
  check(
    "controller cards expose mode, remote mode, offline, fault, and path actions",
    /Run Mode/.test(commandsText) &&
      /Program Mode/.test(commandsText) &&
      /Remote Run/.test(commandsText) &&
      /Remote Program/.test(commandsText) &&
      /Go Offline/.test(commandsText) &&
      /Clear Faults/.test(commandsText) &&
      /Fault Diagnostics/.test(commandsText) &&
      /Who Active/.test(commandsText) &&
      /Path Diagnostics/.test(commandsText) &&
      /Test Edits/.test(commandsText) &&
      /Assemble Edits/.test(commandsText) &&
      /Finalize All Edits/.test(commandsText) &&
      /Cancel Edits/.test(commandsText),
    commandsText,
  );
  check(
    "command cards classify risk (read/write/destructive)",
    /Read/.test(commandsText) && /Write/.test(commandsText) && /Destructive/.test(commandsText),
    commandsText.slice(0, 160),
  );
  const downloadCard = page.locator(".esco-controller__cmd", { hasText: "Download to Controller" }).first();
  const downloadCardText = await downloadCard.innerText();
  check(
    "Download card shows destructive risk, reason blocked, and required next step",
    /Destructive/.test(downloadCardText) &&
      /Reason blocked/i.test(downloadCardText) &&
      /Required next step/i.test(downloadCardText) &&
      /verified ESCO controller transport/i.test(downloadCardText),
    downloadCardText,
  );

  const commandCard = async (label) => {
    const cards = page.locator(".esco-controller__cmd");
    const count = await cards.count();
    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      const title = await card.locator(".esco-controller__cmdlabel").innerText();
      if (title === label || title.startsWith(`${label} (`)) return card;
    }
    throw new Error(`Could not find controller command card: ${label}`);
  };

  const runBlockedCard = async (label, toastText, auditPattern) => {
    const beforeRows = await page.locator(".esco-controller__audit tbody tr").count();
    const card = await commandCard(label);
    await card.locator("button").first().click();
    await page.waitForFunction(
      (count) => document.querySelectorAll(".esco-controller__audit tbody tr").length > count,
      beforeRows,
    );
    const auditText = await page.locator(".esco-controller__audit").innerText();
    const toastVisible = await page.locator(`.esco-toast:has-text("${toastText}")`).count();
    check(`${label} card records an audited blocked workflow`, auditPattern.test(auditText) && /blocked/.test(auditText), `${toastVisible ? toastText : "audit-only"}\n${auditText}`);
  };

  await runBlockedCard("Remote Run", "Remote Run is blocked", /Blocked Remote Run/);
  await runBlockedCard("Remote Program", "Remote Program is blocked", /Blocked Remote Program/);
  await runBlockedCard("Clear Faults", "Clear Faults is blocked", /Blocked Clear Faults/);
  await runBlockedCard("Fault Diagnostics", "Fault Diagnostics is blocked", /Blocked Fault Diagnostics/);
  await runBlockedCard("Path Diagnostics", "Path Diagnostics is blocked", /Blocked Path Diagnostics/);
  await runBlockedCard("Test Edits", "Test Edits is blocked", /Blocked Test Edits/);
  await runBlockedCard("Assemble Edits", "Assemble Edits is blocked", /Blocked Assemble Edits/);
  await runBlockedCard("Finalize All Edits", "Finalize All Edits is blocked", /Blocked Finalize All Edits/);
  await runBlockedCard("Cancel Edits", "Cancel Edits is blocked", /Blocked Cancel Edits/);

  const beforeOfflineRows = await page.locator(".esco-controller__audit tbody tr").count();
  await page.locator(".esco-controller__cmd", { hasText: "Go Offline" }).first().locator("button").first().click();
  await page.locator('.esco-toast:has-text("Offline Simulation is active.")').waitFor({ timeout: 5000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll(".esco-controller__audit tbody tr").length > count,
    beforeOfflineRows,
  );
  const offlineAuditText = await page.locator(".esco-controller__audit").innerText();
  check(
    "Go Offline card records a local audited workflow",
    /go-offline/.test(offlineAuditText) && /ran/.test(offlineAuditText) && /Hardware commands still require/i.test(offlineAuditText),
    offlineAuditText,
  );

  // Connection header surfaces transport name AND kind.
  const connHeader = await page.locator(".esco-controller__state").innerText();
  check("connection header shows transport name and kind", /via .+\(.+\)/.test(connHeader), connHeader);

  // Audit table carries transport + next-step detail on blocked rows.
  const auditFull = await page.locator(".esco-controller__audit").innerText();
  check(
    "audit rows carry status, reason, risk, transport, and required next step detail",
    /Status/.test(auditFull) &&
      /Reason/.test(auditFull) &&
      /Risk/.test(auditFull) &&
      /Transport/.test(auditFull) &&
      /→ .*verified ESCO controller transport/i.test(auditFull),
    auditFull.slice(0, 200),
  );

  // Enumerated commissioning preflight: the Download card lists every safety gate
  // and which is still red, so a blocked command shows the full checklist.
  const downloadPreflight = downloadCard.locator(".esco-controller__preflight").first();
  const preflightSummary = await downloadPreflight.locator("summary").innerText();
  check("Download exposes a commissioning preflight checklist", /Commissioning preflight — \d+\/\d+ checks passed/.test(preflightSummary), preflightSummary);
  await downloadPreflight.locator("summary").click();
  const failChecks = await downloadPreflight.locator(".esco-controller__preflight-check.is-fail").count();
  const totalChecks = await downloadPreflight.locator(".esco-controller__preflight-check").count();
  check("preflight enumerates multiple safety gates with at least one failing", totalChecks >= 4 && failChecks >= 1, `${failChecks} failing of ${totalChecks}`);
  const preflightText = await downloadPreflight.innerText();
  check(
    "preflight names the real-transport gate as the blocker",
    /real controller transport is present/i.test(preflightText) && /No tested controller transport/i.test(preflightText),
    preflightText,
  );

  const finalStatus = await page.locator(".esco-statusbar__connection").innerText();
  check("status bar never shows Connected", !/Connected/i.test(finalStatus), finalStatus);

  const passed = results.filter(Boolean).length;
  console.log(`\nSUMMARY: ${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} catch (err) {
  console.log("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
