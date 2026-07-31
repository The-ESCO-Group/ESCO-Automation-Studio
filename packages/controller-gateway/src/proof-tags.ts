import type { PlcProject } from "@esco/core";
import { localProjectIdentity } from "./identity";
import type {
  ControllerIdentity,
  ControllerIdentityProofField,
  ControllerIdentityTagMap,
  IdentityProofTagExport,
  IdentityProofTagRow,
} from "./types";

export const IDENTITY_PROOF_TAG_EXPORT_SCHEMA = "esco.identityProofTags.v1";
export const LOGIX_STRING_MAX_LENGTH = 82;

export const DEFAULT_IDENTITY_PROOF_TAGS = {
  controllerName: "ESCO_ControllerName",
  controllerType: "ESCO_ControllerType",
  firmwareRevision: "ESCO_FirmwareRevision",
  projectName: "ESCO_ProjectName",
  projectSignature: "ESCO_ProjectSignatureDigest",
  projectSignatureAlgorithm: "ESCO_ProjectSignatureAlgorithm",
} as const satisfies Required<ControllerIdentityTagMap>;

const FIELD_LABELS: Record<ControllerIdentityProofField, string> = {
  controllerName: "Controller name",
  controllerType: "Controller type",
  firmwareRevision: "Firmware revision",
  projectName: "Project name",
  projectSignature: "Project signature digest",
  projectSignatureAlgorithm: "Signature algorithm",
};

const GENERATED_NOTICE =
  "Generated offline by ESCO Automation Studio for read-only online identity proof. " +
  "Import/review in a sandbox project first. This file creates controller-scope constant STRING tags only; " +
  "it never downloads, writes, forces, changes modes, or opens a controller connection.";

export function buildIdentityProofTagExport(
  localProject: PlcProject,
  generatedAt = new Date().toISOString(),
): IdentityProofTagExport {
  const identity = localProjectIdentity(localProject);
  const rows = identityProofTagRows(identity);
  const warnings = proofTagWarnings(rows);
  const controllerName = identity.controllerName ?? localProject.controllers[0]?.name ?? localProject.name;
  return {
    schema: IDENTITY_PROOF_TAG_EXPORT_SCHEMA,
    generatedAt,
    format: "studio5000-l5x-controller-tags",
    fileName: `${safeFilePart(identity.projectName ?? localProject.name ?? "esco-project")}-identity-proof-tags.L5X`,
    l5x: renderIdentityProofTagsL5x({
      controllerName,
      processorType: identity.controllerType ?? localProject.controllers[0]?.processorType,
      exportDate: generatedAt,
      rows,
    }),
    identity,
    identityTags: { ...DEFAULT_IDENTITY_PROOF_TAGS },
    rows,
    installSteps: [
      "Review the generated L5X in an offline or sandbox Studio 5000 project.",
      "Import the controller-scope tags into the target controller project.",
      "Use the plant-controlled download/change procedure to place those tags on the controller.",
      "Go online read-only in ESCO with the default proof tag names and run compare.",
    ],
    warnings,
    evidence: {
      generatedOffline: true,
      physicalControllerWrite: false,
      proprietaryBinaryTouched: false,
      purpose: "read-only-controller-identity-proof",
    },
  };
}

export function identityProofTagRows(identity: ControllerIdentity): IdentityProofTagRow[] {
  const signature = stringValue(identity.projectSignature);
  const algorithm = stringValue(identity.projectSignatureAlgorithm) ?? signatureAlgorithm(signature);
  return [
    row("controllerName", identity.controllerName),
    row("controllerType", identity.controllerType),
    row("firmwareRevision", identity.firmwareRevision),
    row("projectName", identity.projectName),
    row("projectSignature", signatureDigest(signature)),
    row("projectSignatureAlgorithm", algorithm),
  ];
}

function row(field: ControllerIdentityProofField, value: string | undefined): IdentityProofTagRow {
  return {
    field,
    label: FIELD_LABELS[field],
    tagName: DEFAULT_IDENTITY_PROOF_TAGS[field],
    dataType: "STRING",
    value: stringValue(value) ?? "",
    description: `ESCO online identity proof - ${FIELD_LABELS[field]}`,
  };
}

function proofTagWarnings(rows: readonly IdentityProofTagRow[]): string[] {
  const warnings: string[] = [];
  for (const row of rows) {
    if (!row.value) {
      warnings.push(`${row.label} is empty; online compare cannot prove that field until the project supplies it.`);
    }
    if (row.value.length > LOGIX_STRING_MAX_LENGTH) {
      warnings.push(
        `${row.label} is ${row.value.length} characters; a standard Logix STRING holds ${LOGIX_STRING_MAX_LENGTH}. ` +
          "Use a shorter source value or a reviewed custom string type before relying on this proof tag.",
      );
    }
  }
  return warnings;
}

function renderIdentityProofTagsL5x(options: {
  controllerName: string;
  processorType: string | undefined;
  exportDate: string;
  rows: readonly IdentityProofTagRow[];
}): string {
  const xml = new XmlWriter();
  xml.raw('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  xml.open("RSLogix5000Content", {
    SchemaRevision: "1.0",
    TargetType: "Tag",
    TargetCount: options.rows.length,
    ContainsContext: "true",
    ExportName: "ESCO Identity Proof Tags",
    ExportDate: options.exportDate,
    ExportOptions: "References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans",
  });
  xml.comment(GENERATED_NOTICE);
  xml.open("Controller", {
    Use: "Context",
    Name: options.controllerName,
    ProcessorType: options.processorType,
  });
  xml.open("Tags", { Use: "Target" });
  for (const row of options.rows) {
    xml.open("Tag", {
      Name: row.tagName,
      TagType: "Base",
      DataType: row.dataType,
      Constant: "true",
      ExternalAccess: "Read Only",
    });
    xml.cdataEl("Description", row.description);
    xml.cdataEl("Data", row.value, { Format: "String", Length: row.value.length });
    xml.close("Tag");
  }
  xml.close("Tags");
  xml.close("Controller");
  xml.close("RSLogix5000Content");
  return xml.toString();
}

function signatureDigest(signature: string | undefined): string | undefined {
  if (!signature) return undefined;
  const separatorIndex = signature.indexOf(":");
  return separatorIndex >= 0 ? signature.slice(separatorIndex + 1) : signature;
}

function signatureAlgorithm(signature: string | undefined): string | undefined {
  if (!signature) return undefined;
  const separatorIndex = signature.indexOf(":");
  return separatorIndex > 0 ? signature.slice(0, separatorIndex) : undefined;
}

function stringValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "") || "esco-project";
}

type AttrValue = string | number | undefined;

class XmlWriter {
  private parts: string[] = [];
  private depth = 0;

  raw(line: string): void {
    this.parts.push(line);
  }

  comment(text: string): void {
    this.parts.push(`${this.pad()}<!-- ${text.replace(/--/g, "-")} -->`);
  }

  open(tag: string, attrs: Record<string, AttrValue> = {}): void {
    this.parts.push(`${this.pad()}<${tag}${this.attrs(attrs)}>`);
    this.depth += 1;
  }

  close(tag: string): void {
    this.depth -= 1;
    this.parts.push(`${this.pad()}</${tag}>`);
  }

  cdataEl(tag: string, value: string, attrs: Record<string, AttrValue> = {}): void {
    this.parts.push(`${this.pad()}<${tag}${this.attrs(attrs)}>${cdata(value)}</${tag}>`);
  }

  toString(): string {
    return `${this.parts.join("\n")}\n`;
  }

  private pad(): string {
    return "  ".repeat(this.depth);
  }

  private attrs(attrs: Record<string, AttrValue>): string {
    return Object.entries(attrs)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => ` ${key}="${escapeAttr(String(value))}"`)
      .join("");
  }
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}
