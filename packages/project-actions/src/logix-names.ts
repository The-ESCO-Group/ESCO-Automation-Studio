/**
 * Studio 5000 Logix identifiers are 1-40 characters, start with a letter or
 * underscore, contain only letters/digits/underscores, and cannot contain
 * consecutive or trailing underscores. Project actions use this to reject edits
 * at the same boundary the validator would later report.
 */

export function invalidLogixIdentifierReason(name: string): string | undefined {
  if (name.length === 0) return "the name is empty";
  if (name.length > 40) return `the name is ${name.length} characters (limit is 40)`;
  if (!/^[A-Za-z_]/.test(name)) return "the name must begin with a letter or underscore";
  if (!/^[A-Za-z0-9_]+$/.test(name)) return "the name may only contain letters, digits, and underscores";
  if (name.includes("__")) return "the name must not contain consecutive underscores";
  if (name.endsWith("_")) return "the name must not end with an underscore";
  return undefined;
}

export function logixIdentifierError(name: string, label: string): string | undefined {
  const reason = invalidLogixIdentifierReason(name);
  return reason ? `Invalid ${label.toLowerCase()} name "${name}": ${reason}.` : undefined;
}
