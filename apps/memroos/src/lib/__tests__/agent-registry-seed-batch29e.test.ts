// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { resolveFromRepoRoot } from "@/lib/paths";

const TMP = path.join(os.tmpdir(), `agent-seed-b29e-${randomUUID()}`);

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MEMROOS_SEED_REGISTERED_AGENTS;
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function seedFromConfig(body: unknown) {
  process.env.MEMROOS_ROOT = TMP;
  process.env.MEMROOS_SEED_REGISTERED_AGENTS = "1";
  const configPath = resolveFromRepoRoot("agents.config.json");
  fs.writeFileSync(configPath, JSON.stringify(body), "utf8");
  process.env.SQLITE_DB_PATH = path.join(TMP, `reg-b29e-${randomUUID()}.db`);
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  const db = dbModule.getDb();
  initSchema(db);
  const { seedRegisteredAgents } = await import("../agent-registry-seed");
  seedRegisteredAgents(db);
  return { db, closeDb: dbModule.closeDb };
}

describe("agent-registry-seed batch29e — parseSeedAgent validation (85–89)", () => {
  it("rejects invalid platform", async () => {
    fs.mkdirSync(TMP, { recursive: true });
    const { db, closeDb } = await seedFromConfig({
      remoteAgents: [
        {
          id: "id-b29e",
          name: "n",
          role: "r",
          platform: "not-a-platform",
          location: "local",
        },
      ],
    });
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM registered_agents WHERE id = 'id-b29e'`).get() as { c: number }).c,
    ).toBe(0);
    closeDb();
  });

  it("rejects invalid protocol", async () => {
    fs.mkdirSync(TMP, { recursive: true });
    const { db, closeDb } = await seedFromConfig({
      remoteAgents: [
        {
          id: "id-proto-b29e",
          name: "n",
          role: "r",
          platform: "codex",
          protocol: "not-rest",
          location: "local",
        },
      ],
    });
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM registered_agents WHERE id = 'id-proto-b29e'`).get() as { c: number }).c,
    ).toBe(0);
    closeDb();
  });

  it("rejects invalid location", async () => {
    fs.mkdirSync(TMP, { recursive: true });
    const { db, closeDb } = await seedFromConfig({
      remoteAgents: [
        {
          id: "id-loc-b29e",
          name: "n",
          role: "r",
          platform: "codex",
          location: "orbit",
        },
      ],
    });
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM registered_agents WHERE id = 'id-loc-b29e'`).get() as { c: number }).c,
    ).toBe(0);
    closeDb();
  });
});
