import type { PlcProject, UdtMember, UserDefinedType } from "@esco/core";
import { fail, ok } from "./helpers";
import type { ProjectActionResult } from "./types";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface AddUdtMemberInput {
  udtId: string;
  member: UdtMember;
}

export interface UpdateUdtMemberInput {
  udtId: string;
  /** Existing member name to update. */
  memberName: string;
  patch: Partial<UdtMember>;
}

export interface RemoveUdtMemberInput {
  udtId: string;
  memberName: string;
}

function findUdt(project: PlcProject, udtId: string): UserDefinedType | undefined {
  for (const controller of project.controllers) {
    const udt = controller.dataTypes.find((candidate) => candidate.id === udtId);
    if (udt) return udt;
  }
  return undefined;
}

function mapUdtMembers(
  project: PlcProject,
  udtId: string,
  fn: (members: UdtMember[]) => UdtMember[],
): PlcProject {
  return {
    ...project,
    controllers: project.controllers.map((controller) => ({
      ...controller,
      dataTypes: controller.dataTypes.map((udt) =>
        udt.id === udtId ? { ...udt, members: fn(udt.members) } : udt,
      ),
    })),
  };
}

/** Validate a member's shape against the UDT it belongs to. `existing` excludes the member being updated. */
function validateMember(
  udt: UserDefinedType,
  member: UdtMember,
  existing: UdtMember[],
): string | undefined {
  if (!member.name?.trim()) return "Member name is required.";
  if (!IDENTIFIER.test(member.name)) return `Invalid member name "${member.name}".`;
  if (existing.some((other) => other.name.toLowerCase() === member.name.toLowerCase())) {
    return `Member "${member.name}" already exists in "${udt.name}".`;
  }
  if (!member.dataType?.trim()) return "Member data type is required.";
  if (member.dataType.toLowerCase() === udt.name.toLowerCase()) {
    return `Member "${member.name}" cannot use its own UDT "${udt.name}" as a type.`;
  }
  if (member.dimension !== undefined && (!Number.isInteger(member.dimension) || member.dimension < 0)) {
    return "Member dimension must be a non-negative integer.";
  }
  return undefined;
}

/** Add a member to a UDT. */
export function addUdtMember(
  project: PlcProject,
  input: AddUdtMemberInput,
): ProjectActionResult<{ udtId: string; memberName: string }> {
  const udt = findUdt(project, input.udtId);
  if (!udt) return fail(project, `UDT "${input.udtId}" was not found.`);

  const member: UdtMember = {
    name: input.member.name?.trim() ?? "",
    dataType: input.member.dataType?.trim() ?? "",
    ...(input.member.dimension ? { dimension: input.member.dimension } : {}),
    ...(input.member.description?.trim() ? { description: input.member.description.trim() } : {}),
  };
  const error = validateMember(udt, member, udt.members);
  if (error) return fail(project, error);

  return ok(
    mapUdtMembers(project, input.udtId, (members) => [...members, member]),
    { udtId: input.udtId, memberName: member.name },
  );
}

/** Update one member of a UDT (rename, retype, redimension, or re-describe). */
export function updateUdtMember(
  project: PlcProject,
  input: UpdateUdtMemberInput,
): ProjectActionResult<{ udtId: string; memberName: string }> {
  const udt = findUdt(project, input.udtId);
  if (!udt) return fail(project, `UDT "${input.udtId}" was not found.`);
  const current = udt.members.find((member) => member.name === input.memberName);
  if (!current) return fail(project, `Member "${input.memberName}" was not found in "${udt.name}".`);

  const merged: UdtMember = {
    name: input.patch.name?.trim() ?? current.name,
    dataType: input.patch.dataType?.trim() ?? current.dataType,
    dimension:
      input.patch.dimension !== undefined ? input.patch.dimension || undefined : current.dimension,
    description:
      input.patch.description !== undefined
        ? input.patch.description.trim() || undefined
        : current.description,
  };
  const others = udt.members.filter((member) => member.name !== input.memberName);
  const error = validateMember(udt, merged, others);
  if (error) return fail(project, error);

  return ok(
    mapUdtMembers(project, input.udtId, (members) =>
      members.map((member) => (member.name === input.memberName ? merged : member)),
    ),
    { udtId: input.udtId, memberName: merged.name },
  );
}

/** Remove one member from a UDT. */
export function removeUdtMember(
  project: PlcProject,
  input: RemoveUdtMemberInput,
): ProjectActionResult<{ udtId: string; memberName: string }> {
  const udt = findUdt(project, input.udtId);
  if (!udt) return fail(project, `UDT "${input.udtId}" was not found.`);
  if (!udt.members.some((member) => member.name === input.memberName)) {
    return fail(project, `Member "${input.memberName}" was not found in "${udt.name}".`);
  }

  return ok(
    mapUdtMembers(project, input.udtId, (members) =>
      members.filter((member) => member.name !== input.memberName),
    ),
    { udtId: input.udtId, memberName: input.memberName },
  );
}
