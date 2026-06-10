import { describe, expect, it } from "vitest";
import { toHex } from "../bytes";
import { hexToBytes } from "../testing/hex";
import { decodeMessageRouterResponse } from "../cip/message-router";
import {
  buildReadTemplateRequest,
  buildTemplateAttributesRequest,
  decodeStructureValue,
  parseTemplateAttributesReply,
  parseTemplateDefinition,
  templateReadSize,
  type TemplateAttributes,
} from "./templates";

const ATTRS: TemplateAttributes = {
  objectDefinitionSize: 30,
  structureSize: 8,
  memberCount: 2,
  structureHandle: 0x0fce,
};

// Two members: "Count" DINT @0, "Flag" BOOL bit 1 @4; template name "MyUdt;n".
const DEFINITION = hexToBytes(
  "00 00 c4 00 00 00 00 00 " + // info 0, DINT, offset 0
    "01 00 c1 00 04 00 00 00 " + // info 1 (bit), BOOL, offset 4
    "4d 79 55 64 74 3b 6e 00 " + // "MyUdt;n\0"
    "43 6f 75 6e 74 00 " + // "Count\0"
    "46 6c 61 67 00", // "Flag\0"
);

describe("template attribute requests", () => {
  it("builds the golden Get Attribute List request", () => {
    expect(toHex(buildTemplateAttributesRequest(0x123))).toBe(
      "03 03 20 6c 25 00 23 01 04 00 04 00 05 00 02 00 01 00",
    );
  });

  it("parses the attribute reply (id/status/value triplets)", () => {
    const response = decodeMessageRouterResponse(
      hexToBytes(
        "83 00 00 00 " +
          "04 00 " + // 4 attributes
          "04 00 00 00 1e 00 00 00 " + // definition size 30 words
          "05 00 00 00 08 00 00 00 " + // structure size 8 bytes
          "02 00 00 00 02 00 " + // member count 2
          "01 00 00 00 ce 0f", // handle 0x0FCE
      ),
    );
    expect(parseTemplateAttributesReply(response)).toEqual(ATTRS);
  });

  it("rejects replies with failed attributes or missing fields", () => {
    const failed = decodeMessageRouterResponse(
      hexToBytes("83 00 00 00 01 00 04 00 01 00 00 00 00 00"),
    );
    expect(() => parseTemplateAttributesReply(failed)).toThrow(/failed with status/);

    const partial = decodeMessageRouterResponse(
      hexToBytes("83 00 00 00 01 00 02 00 00 00 02 00"),
    );
    expect(() => parseTemplateAttributesReply(partial)).toThrow(/missing required/);
  });
});

describe("template definition reads", () => {
  it("computes the read size with the documented -21 constant", () => {
    expect(templateReadSize(30)).toBe(99);
    expect(() => templateReadSize(5)).toThrow(/too small/);
  });

  it("builds the golden Read Template request", () => {
    expect(toHex(buildReadTemplateRequest(0x123, 0, 99))).toBe(
      "4c 03 20 6c 25 00 23 01 00 00 00 00 63 00",
    );
    expect(toHex(buildReadTemplateRequest(0x123, 24, 75))).toBe(
      "4c 03 20 6c 25 00 23 01 18 00 00 00 4b 00",
    );
  });

  it("parses member entries, template name, and member names", () => {
    const template = parseTemplateDefinition(DEFINITION, ATTRS, 0x123);
    expect(template.name).toBe("MyUdt");
    expect(template.templateInstance).toBe(0x123);
    expect(template.members).toHaveLength(2);
    expect(template.members[0]).toMatchObject({
      name: "Count",
      atomicType: 0xc4,
      offset: 0,
      isStructure: false,
      dimensions: 0,
    });
    expect(template.members[1]).toMatchObject({ name: "Flag", atomicType: 0xc1, info: 1, offset: 4 });
  });

  it("degrades to placeholder names instead of failing on short name data", () => {
    const truncated = DEFINITION.slice(0, 16 + 8); // entries + template name only
    const template = parseTemplateDefinition(truncated, ATTRS, 0x40);
    expect(template.name).toBe("MyUdt");
    expect(template.members[0].name).toBe("member0");
    expect(template.members[1].name).toBe("member1");
  });

  it("rejects definitions shorter than the member entries", () => {
    expect(() => parseTemplateDefinition(DEFINITION.slice(0, 10), ATTRS, 1)).toThrow(
      /member entries/,
    );
  });
});

describe("decodeStructureValue", () => {
  it("decodes atomic members and packed BOOL bits", () => {
    const template = parseTemplateDefinition(DEFINITION, ATTRS, 0x123);
    const decoded = decodeStructureValue(template, hexToBytes("d2 04 00 00 02 00 00 00"));
    expect(decoded.templateName).toBe("MyUdt");
    expect(decoded.values["Count"]).toBe(1234);
    expect(decoded.values["Flag"]).toBe(true); // byte 4 = 0x02, bit 1
    expect(decoded.undecodedMembers).toEqual([]);
  });

  it("decodes atomic array members using info as the element count", () => {
    // One member: "Vals" DINT[3] @0 (dims=1 → type word 0x20C4, info=3).
    const definition = hexToBytes(
      "03 00 c4 20 00 00 00 00 " + "56 3b 6e 00 " + "56 61 6c 73 00",
    );
    const attrs: TemplateAttributes = { ...ATTRS, memberCount: 1, structureSize: 12 };
    const template = parseTemplateDefinition(definition, attrs, 7);
    const decoded = decodeStructureValue(
      template,
      hexToBytes("01 00 00 00 02 00 00 00 03 00 00 00"),
    );
    expect(decoded.values["Vals"]).toEqual([1, 2, 3]);
  });

  it("decodes nested structures recursively when their templates resolve", () => {
    // Outer: { Inner: <template 0x125> @0, Total: DINT @4 }
    const outerDef = hexToBytes(
      "00 00 25 81 00 00 00 00 " + // Inner (struct, template 0x125) @0
        "00 00 c4 00 04 00 00 00 " + // Total DINT @4
        "4f 3b 6e 00 49 6e 6e 65 72 00 54 6f 74 61 6c 00", // "O;n" Inner Total
    );
    const outer = parseTemplateDefinition(
      outerDef,
      { objectDefinitionSize: 30, structureSize: 8, memberCount: 2, structureHandle: 0x2222 },
      0x124,
    );
    // Inner: { Count: DINT @0 }
    const innerDef = hexToBytes("00 00 c4 00 00 00 00 00 49 3b 6e 00 43 6f 75 6e 74 00");
    const inner = parseTemplateDefinition(
      innerDef,
      { objectDefinitionSize: 30, structureSize: 4, memberCount: 1, structureHandle: 0x3333 },
      0x125,
    );

    const decoded = decodeStructureValue(outer, hexToBytes("07 00 00 00 09 00 00 00"), {
      resolveTemplate: (instance) => (instance === 0x125 ? inner : undefined),
    });
    expect(decoded.values["Total"]).toBe(9);
    const nested = decoded.values["Inner"];
    expect(nested && typeof nested === "object" && !Array.isArray(nested)).toBe(true);
    expect((nested as { values: Record<string, unknown> }).values["Count"]).toBe(7);
    expect(decoded.undecodedMembers).toEqual([]);
  });

  it("merges nested undecoded paths with dotted names and honors the depth cap", () => {
    // Self-referential template: { Self: <template 9> @0 } — the depth guard
    // must terminate and report the leaf as undecoded.
    const selfDef = hexToBytes("00 00 09 80 00 00 00 00 53 3b 6e 00 53 65 6c 66 00");
    const selfTemplate = parseTemplateDefinition(
      selfDef,
      { objectDefinitionSize: 30, structureSize: 4, memberCount: 1, structureHandle: 0x4444 },
      9,
    );
    const decoded = decodeStructureValue(selfTemplate, hexToBytes("00 00 00 00"), {
      resolveTemplate: () => selfTemplate,
      maxDepth: 2,
    });
    // Levels 0 and 1 recurse; the guard nulls the member at depth 2.
    expect(decoded.undecodedMembers).toEqual(["Self.Self.Self"]);
  });

  it("reports nested structures as undecoded instead of guessing", () => {
    // One member: nested struct (type word 0x8123) @0.
    const definition = hexToBytes(
      "00 00 23 81 00 00 00 00 " + "4e 3b 6e 00 " + "49 6e 6e 65 72 00",
    );
    const attrs: TemplateAttributes = { ...ATTRS, memberCount: 1 };
    const template = parseTemplateDefinition(definition, attrs, 9);
    expect(template.members[0].isStructure).toBe(true);
    expect(template.members[0].templateInstance).toBe(0x123);
    const decoded = decodeStructureValue(template, hexToBytes("aa bb cc dd"));
    expect(decoded.values["Inner"]).toBeNull();
    expect(decoded.undecodedMembers).toEqual(["Inner"]);
  });

  it("returns null for members whose bytes are out of range", () => {
    const template = parseTemplateDefinition(DEFINITION, ATTRS, 0x123);
    const decoded = decodeStructureValue(template, hexToBytes("d2 04")); // truncated value
    expect(decoded.values["Count"]).toBeNull();
    expect(decoded.undecodedMembers).toContain("Count");
  });
});
