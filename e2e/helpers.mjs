export const URL = process.env.E2E_URL || "http://localhost:5173/";

export const STARTER_L5X = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" TargetName="E2E_Starter" ContentType="Controller">
  <Controller Use="Target" Name="E2E_Starter">
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

export const ribbonButton = (page, label) =>
  page.locator(`.esco-ribbon__button:has-text("${label}")`).first();

export const l5xInput = (page) =>
  page.locator('input[type="file"][accept*=".l5x"]').first();

export async function dismissToasts(page) {
  while ((await page.locator(".esco-toast__close").count()) > 0) {
    await page.locator(".esco-toast__close").first().click();
  }
}

export async function importL5XText(page, text, name = "fixture.L5X") {
  await l5xInput(page).setInputFiles({
    name,
    mimeType: "application/xml",
    buffer: Buffer.from(text),
  });
  await page.locator('button:has-text("MainRoutine")').first().waitFor({ timeout: 8000 });
}

export async function importL5XPath(page, path) {
  await l5xInput(page).setInputFiles(path);
  await page.locator('button:has-text("MainRoutine"), button:has-text("Main")').first().waitFor({ timeout: 8000 });
}

export async function importStarterProject(page) {
  await importL5XText(page, STARTER_L5X, "starter.L5X");
  await openMainRoutine(page);
  await dismissToasts(page);
}

export async function createBlankProject(page) {
  await page.locator('button:has-text("Create New Routine")').click();
  await page.locator('button:has-text("Add Rung")').waitFor({ timeout: 8000 });
  await dismissToasts(page);
}

export async function openMainRoutine(page) {
  await page.locator('button:has-text("MainRoutine")').first().click();
  await page.locator('button:has-text("Add Rung")').waitFor({ timeout: 8000 });
}
