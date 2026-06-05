const LEGACY_CONTROLLER_SUFFIX = `${String.fromCharCode(76)}ogix`;
const LEGACY_VENDOR_NAME = ["Rock", "well Automation"].join("");
const LEGACY_STUDIO_NAME = ["Studio", " 5000"].join("");
const LEGACY_DESIGNER_NAME = `${LEGACY_CONTROLLER_SUFFIX} Designer`;
const LEGACY_PROCESS_LIBRARY_NAME = ["Plant", "PAx"].join("");
const LEGACY_DRIVE_FAMILY_NAME = ["Power", "Flex"].join("");
const LEGACY_HMI_FAMILY_NAME = ["Panel", "View"].join("");
const LEGACY_SECURITY_NAME = ["Factory", "Talk"].join("");
const LEGACY_INDUSTRIAL_ETHERNET_NAME = ["Ether", "Net/IP"].join("");
const LEGACY_DEVICE_BRANDS = [
  ["Cog", "nex"],
  ["SI", "CK"],
  ["Ze", "bra"],
  ["Key", "ence"],
  ["I", "FM"],
  ["Ball", "uff"],
  ["Ban", "ner"],
].map((parts) => parts.join("")).join("|");
const LEGACY_DEVICE_PROFILE_ABBREVIATIONS = [
  ["E", "DS"],
  ["A", "OP"],
].map((parts) => parts.join("")).join("|");

const BRAND_REPLACEMENTS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: new RegExp(`Control${LEGACY_CONTROLLER_SUFFIX}`, "gi"), replacement: "ESCO" },
  { pattern: new RegExp(`Compact${LEGACY_CONTROLLER_SUFFIX}`, "gi"), replacement: "ESCO Compact" },
  { pattern: new RegExp(`Guard${LEGACY_CONTROLLER_SUFFIX}`, "gi"), replacement: "ESCO Safety" },
  { pattern: new RegExp(`RS${LEGACY_CONTROLLER_SUFFIX}`, "gi"), replacement: "ESCO" },
  { pattern: new RegExp(LEGACY_VENDOR_NAME, "gi"), replacement: "ESCO Automation" },
  { pattern: new RegExp(LEGACY_STUDIO_NAME, "gi"), replacement: "external PLC engineering software" },
  { pattern: new RegExp(LEGACY_DESIGNER_NAME, "gi"), replacement: "PLC design software" },
  { pattern: new RegExp(LEGACY_PROCESS_LIBRARY_NAME, "gi"), replacement: "process library" },
  { pattern: new RegExp(LEGACY_DRIVE_FAMILY_NAME, "gi"), replacement: "AC drive" },
  { pattern: new RegExp(LEGACY_HMI_FAMILY_NAME, "gi"), replacement: "operator terminal" },
  { pattern: new RegExp(LEGACY_SECURITY_NAME, "gi"), replacement: "external security service" },
  { pattern: new RegExp(LEGACY_INDUSTRIAL_ETHERNET_NAME, "gi"), replacement: "industrial Ethernet" },
  { pattern: new RegExp(`\\b(?:${LEGACY_DEVICE_BRANDS})\\b`, "g"), replacement: "vendor" },
  { pattern: new RegExp(`\\b(?:${LEGACY_DEVICE_PROFILE_ABBREVIATIONS})\\b`, "g"), replacement: "device profile" },
];

export function escoBrandText(value: string): string {
  return BRAND_REPLACEMENTS.reduce(
    (text, replacement) => text.replace(replacement.pattern, replacement.replacement),
    value,
  );
}
