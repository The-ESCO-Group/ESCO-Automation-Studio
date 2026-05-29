import { describe, expect, it } from "vitest";
import {
  createDefaultHmiProject,
  createHmiElement,
  createHmiScreen,
  HMI_ELEMENT_REGISTRY,
  validateHmiProject,
} from "./index";

describe("hmi model foundation", () => {
  it("creates an empty HMI project without demo screens", () => {
    const project = createDefaultHmiProject("Operator HMI");

    expect(project.name).toBe("Operator HMI");
    expect(project.screens).toHaveLength(0);
    expect(project.popups).toHaveLength(0);
    expect(project.systemBanner.name).toBe("System Banner");
    expect(project.targetDevice.supportedFeatures).toContain("runtime-preview");
  });

  it("registers the first View Designer element slice", () => {
    expect(HMI_ELEMENT_REGISTRY.get("common.button")?.displayName).toBe("Button");
    expect(HMI_ELEMENT_REGISTRY.get("common.numeric-display")?.category).toBe("common");
    expect(HMI_ELEMENT_REGISTRY.get("trends.trend-chart")?.runtimeSupport).toBe("model-only");
    expect(HMI_ELEMENT_REGISTRY.get("alarms.alarm-summary")?.runtimeSupport).toBe("model-only");
  });

  it("preserves unknown elements as readonly unsupported content", () => {
    const element = createHmiElement("vendorx.custom-gauge", "Vendor Gauge", { raw: true });

    expect(element.unsupported?.originalType).toBe("vendorx.custom-gauge");
    expect(element.unsupported?.readonlyReason).toContain("not registered");
  });

  it("validates missing bindings and readonly unsupported elements", () => {
    const project = createDefaultHmiProject();
    const screen = createHmiScreen("Main");
    const element = createHmiElement("common.numeric-display");
    element.bindings.push({
      id: "bind_1",
      targetProperty: "value",
      source: { kind: "tag", path: "MissingTag", dataType: "DINT" },
      mode: "read",
    });
    screen.elements.push(element, createHmiElement("UNSUPPORTED_VENDOR_BLOCK"));
    project.screens.push(screen);
    project.homeScreenId = screen.id;

    const findings = validateHmiProject(project, { knownTagPaths: ["GoodTag"] });

    expect(findings.some((finding) => finding.ruleId === "hmi-binding-missing-tag")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "hmi-element-unsupported")).toBe(true);
  });
});
