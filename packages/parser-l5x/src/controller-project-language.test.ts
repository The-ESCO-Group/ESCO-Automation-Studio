import { describe, expect, it } from "vitest";
import { exportL5X } from "./exportL5X";
import { importL5X } from "./index";

// When localized comments/descriptions are enabled, Studio 5000 records the
// project documentation language configuration on the <Controller> element:
// CurrentProjectLanguage (the language shown in the editor), DefaultProjectLanguage
// (the fallback when a comment lacks the current language), and ControllerLanguage
// (the controller's authoring language). The simulator never uses these, but they
// are project settings an engineer expects to keep, so they must survive
// export -> import rather than being silently dropped (mirrors the
// time-slice / SFC / redundancy controller metadata).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="LineCtl" ProcessorType="1756-L83E" MajorRev="33" MinorRev="11" CurrentProjectLanguage="en-US" DefaultProjectLanguage="en-US" ControllerLanguage="fr-FR">
    <Programs>
      <Program Name="MainProgram">
        <Routines>
          <Routine Name="MainRoutine" Type="RLL"><RLLContent/></Routine>
        </Routines>
      </Program>
    </Programs>
  </Controller>
</RSLogix5000Content>`;

describe("importL5X — controller project documentation language", () => {
  const controllerOf = (xml: string) => importL5X(xml).project.controllers[0]!;

  it("imports the project documentation language attributes verbatim", () => {
    const controller = controllerOf(XML);
    expect(controller.currentProjectLanguage).toBe("en-US");
    expect(controller.defaultProjectLanguage).toBe("en-US");
    expect(controller.controllerLanguage).toBe("fr-FR");
  });

  it("round-trips the documentation language metadata through export -> import", () => {
    const { xml } = exportL5X(importL5X(XML).project);
    const controller = controllerOf(xml);
    expect(controller.currentProjectLanguage).toBe("en-US");
    expect(controller.defaultProjectLanguage).toBe("en-US");
    expect(controller.controllerLanguage).toBe("fr-FR");
  });

  it("leaves the fields undefined when the controller omits them", () => {
    const bare = `<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0">
  <Controller Use="Target" Name="BareCtl" ProcessorType="1756-L83E"/>
</RSLogix5000Content>`;
    const controller = controllerOf(bare);
    expect(controller.currentProjectLanguage).toBeUndefined();
    expect(controller.defaultProjectLanguage).toBeUndefined();
    expect(controller.controllerLanguage).toBeUndefined();
  });
});
