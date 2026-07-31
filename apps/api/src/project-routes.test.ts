import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createController, createProgram, createProject, createRoutine } from "@esco/core";
import type { PlcProject } from "@esco/core";
import { EscoGatewayClient } from "../../web/src/gateway-client";
import { ApiAuthPolicy } from "./auth";
import { CloudProjectStore } from "./cloud-project-store";
import { createApiServer } from "./server";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

async function listenEphemeral(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as AddressInfo).port;
}

async function tempStore(): Promise<CloudProjectStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "esco-project-routes-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return new CloudProjectStore(dir);
}

function demoProject(name = "Hosted Line"): PlcProject {
  const project = createProject(name);
  project.id = "hosted/project 1";
  const controller = createController(project.id, "PLC_1");
  const program = createProgram(controller.id, "MainProgram");
  program.routines.push(createRoutine(program.id, "MainRoutine"));
  controller.programs.push(program);
  project.controllers.push(controller);
  return project;
}

describe("hosted project routes", () => {
  it("require auth and round-trip cloud projects through the web client", async () => {
    const store = await tempStore();
    const apiPort = await listenEphemeral(createApiServer(undefined, {
      authPolicy: new ApiAuthPolicy({ token: "secret-token" }),
      projectStore: store,
      sessionCleanupIntervalMs: 0,
    }));
    const baseUrl = `http://127.0.0.1:${apiPort}`;

    const blocked = await fetch(`${baseUrl}/api/projects`);
    expect(blocked.status).toBe(401);

    const client = new EscoGatewayClient({ baseUrl, apiToken: "secret-token", sessionId: "cloud-test" });
    const first = await client.saveCloudProject(demoProject());
    const listed = await client.listCloudProjects();
    const opened = await client.openCloudProject("hosted/project 1");

    expect(first.summary.revision).toMatch(/^sha256:/);
    expect(listed.map((project) => project.id)).toEqual(["hosted/project 1"]);
    expect(opened.project.name).toBe("Hosted Line");
    expect(opened.summary.routineCount).toBe(1);

    await client.saveCloudProject(demoProject("Hosted Line Updated"));
    await expect(client.saveCloudProject(demoProject("Stale"), first.summary.revision))
      .rejects.toThrow("has changed since it was opened");

    expect((await client.deleteCloudProject("hosted/project 1")).ok).toBe(true);
    await expect(client.openCloudProject("hosted/project 1")).rejects.toThrow("was not found");
  });
});
