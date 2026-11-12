// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { resolveFromRepoRoot } from "@/lib/paths";

const TMP = path.join(os.tmpdir(), `agent-seed-b35b-${randomUUID()}`);

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MEMROOS_SEED_REGISTERED_AGENTS;
  delete process.env.MEMROOS_ROOT;
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP, { recursive: true, force: true });
  vi.resetModules();
});

async function seedFromConfig(body: unknown) {
  process.env.MEMROOS_ROOT = TMP;
  process.env.MEMROOS_SEED_REGISTERED_AGENTS = "1";
  const configPath = resolveFromRepoRoot("agents.config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(body), "utf8");
  process.env.SQLITE_DB_PATH = path.join(TMP, `reg-b35b-${randomUUID()}.db`);
  const dbModule = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  const db = dbModule.getDb();
  initSchema(db);
  const { seedRegisteredAgents } = await import("../agent-registry-seed");
  seedRegisteredAgents(db);
  return { db, closeDb: dbModule.closeDb };
}

describe("agent-registry-seed batch35b — parseSeedAgent guards (85–86)", () => {
  it("rejects empty name and empty role", async () => {
    fs.mkdirSync(TMP, { recursive: true });
    const { db, closeDb } = await seedFromConfig({
      remoteAgents: [
        {
          id: `id-name-b35b-${randomUUID().slice(0, 6)}`,
          name: "   ",
          role: "operator",
          platform: "codex",
          location: "local",
        },
        {
          id: `id-role-b35b-${randomUUID().slice(0, 6)}`,
          name: "Valid Name",
          role: "",
          platform: "codex",
          location: "local",
        },
      ],
    });
    expect((db.prepare(`SELECT COUNT(*) AS c FROM registered_agents`).get() as { c: number }).c).toBe(0);
    closeDb();
  });
});
