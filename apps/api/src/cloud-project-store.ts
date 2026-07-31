import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlcProject } from "@esco/core";
import { deserializeProjectFile, serializeProject } from "@esco/project-store";

export interface CloudProjectSummary {
  id: string;
  name: string;
  description?: string;
  controllerCount: number;
  routineCount: number;
  tagCount: number;
  updatedAt: string;
  savedAt: string;
  revision: string;
  sizeBytes: number;
}

export interface CloudProjectRecord {
  project: PlcProject;
  summary: CloudProjectSummary;
  warnings: string[];
  migrationsApplied: string[];
}

export interface SaveCloudProjectOptions {
  expectedRevision?: string;
}

export class CloudProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super(`Cloud project "${projectId}" was not found.`);
    this.name = "CloudProjectNotFoundError";
  }
}

export class CloudProjectConflictError extends Error {
  constructor(
    readonly projectId: string,
    readonly expectedRevision: string,
    readonly actualRevision: string | undefined,
  ) {
    super(
      actualRevision
        ? `Cloud project "${projectId}" has changed since it was opened.`
        : `Cloud project "${projectId}" does not exist at the expected revision.`,
    );
    this.name = "CloudProjectConflictError";
  }
}

export class CloudProjectStore {
  constructor(private readonly rootDir: string = defaultCloudProjectStoreDir()) {}

  async list(): Promise<CloudProjectSummary[]> {
    await this.ensureDir();
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const summaries: CloudProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".easproj.json")) continue;
      try {
        const text = await readFile(path.join(this.rootDir, entry.name), "utf8");
        summaries.push(summaryFromText(text));
      } catch {
        // Ignore corrupt side files; the explicit open path still reports errors.
      }
    }
    return summaries.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  }

  async read(projectId: string): Promise<CloudProjectRecord> {
    const text = await this.readProjectText(projectId);
    return recordFromText(text);
  }

  async save(project: PlcProject, options: SaveCloudProjectOptions = {}): Promise<CloudProjectRecord> {
    if (!project.id?.trim()) throw new Error("Cloud projects require a project id.");
    const target = this.projectPath(project.id);
    const expectedRevision = options.expectedRevision?.trim();
    if (expectedRevision) {
      const actualRevision = await this.currentRevision(project.id);
      if (actualRevision !== expectedRevision) {
        throw new CloudProjectConflictError(project.id, expectedRevision, actualRevision);
      }
    }

    await this.ensureDir();
    const text = serializeProject(project);
    const parsed = recordFromText(text); // validates the canonical text before it is written
    const temp = path.join(this.rootDir, `${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, text, "utf8");
    await rename(temp, target);
    return parsed;
  }

  async delete(projectId: string): Promise<boolean> {
    try {
      await rm(this.projectPath(projectId), { force: false });
      return true;
    } catch (cause) {
      if (isNotFound(cause)) return false;
      throw cause;
    }
  }

  private async currentRevision(projectId: string): Promise<string | undefined> {
    try {
      return revisionForText(await this.readProjectText(projectId));
    } catch (cause) {
      if (cause instanceof CloudProjectNotFoundError) return undefined;
      throw cause;
    }
  }

  private async readProjectText(projectId: string): Promise<string> {
    try {
      return await readFile(this.projectPath(projectId), "utf8");
    } catch (cause) {
      if (isNotFound(cause)) throw new CloudProjectNotFoundError(projectId);
      throw cause;
    }
  }

  private projectPath(projectId: string): string {
    return path.join(this.rootDir, `${storageKey(projectId)}.easproj.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }
}

export function cloudProjectStoreFromEnv(env: Record<string, string | undefined> = process.env): CloudProjectStore {
  return new CloudProjectStore(env.ESCO_PROJECT_STORE_DIR?.trim() || defaultCloudProjectStoreDir());
}

function defaultCloudProjectStoreDir(): string {
  return path.join(process.cwd(), ".esco-cloud-projects");
}

function storageKey(projectId: string): string {
  return createHash("sha256").update(projectId).digest("hex").slice(0, 32);
}

function recordFromText(text: string): CloudProjectRecord {
  const result = deserializeProjectFile(text);
  return {
    project: result.project,
    summary: summaryFromText(text, result.project),
    warnings: result.warnings,
    migrationsApplied: result.migrationsApplied,
  };
}

function summaryFromText(text: string, projectOverride?: PlcProject): CloudProjectSummary {
  const parsed = JSON.parse(text) as { savedAt?: unknown };
  const project = projectOverride ?? deserializeProjectFile(text).project;
  return {
    id: project.id,
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    controllerCount: project.controllers.length,
    routineCount: project.controllers.reduce(
      (sum, controller) => sum + controller.programs.reduce((programSum, program) => programSum + program.routines.length, 0),
      0,
    ),
    tagCount: project.controllers.reduce(
      (sum, controller) =>
        sum +
        controller.controllerTags.length +
        controller.programs.reduce((programSum, program) => programSum + program.programTags.length, 0),
      0,
    ),
    updatedAt: project.updatedAt,
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    revision: revisionForText(text),
    sizeBytes: Buffer.byteLength(text, "utf8"),
  };
}

function revisionForText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "ENOENT";
}
