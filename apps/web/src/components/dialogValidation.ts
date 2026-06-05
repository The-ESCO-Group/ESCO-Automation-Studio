export function studioIdentifierError(value: string, label: string): string | undefined {
  const name = value.trim();
  if (!name) return `${label} name is required.`;
  if (name.length > 40) return `${label} name must be 40 characters or fewer.`;
  if (!/^[A-Za-z_]/.test(name)) return `${label} name must start with a letter or underscore.`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return `${label} name may only contain letters, digits, and underscores.`;
  }
  if (name.includes("__")) return `${label} name must not contain consecutive underscores.`;
  if (name.endsWith("_")) return `${label} name must not end with an underscore.`;
  return undefined;
}

export function integerFieldError(
  value: string,
  label: string,
  options: { required?: boolean; min?: number } = {},
): string | undefined {
  const text = value.trim();
  const required = options.required !== false;
  if (!text) return required ? `${label} is required.` : undefined;
  const parsed = Number(text);
  if (!Number.isInteger(parsed)) return `${label} must be a whole number.`;
  if (options.min != null && parsed < options.min) return `${label} must be ${options.min} or greater.`;
  return undefined;
}

export function duplicateNameError(
  value: string,
  existingNames: string[],
  label: string,
  currentName?: string,
): string | undefined {
  const name = value.trim();
  if (!name || name.toLowerCase() === currentName?.trim().toLowerCase()) return undefined;
  return existingNames.some((candidate) => candidate.trim().toLowerCase() === name.toLowerCase())
    ? `${label} "${name}" already exists.`
    : undefined;
}

export function parsedInteger(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export const DIALOG_HELP_EVENT = "esco-dialog-help";

export interface DialogHelpEventDetail {
  title: string;
  body: string;
}

export function showDialogHelp(title: string, body: string) {
  window.dispatchEvent(new CustomEvent<DialogHelpEventDetail>(DIALOG_HELP_EVENT, { detail: { title, body } }));
}
