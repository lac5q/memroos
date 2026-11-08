// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const CONFIG_DIR = path.join(os.tmpdir(), `agent-seed-b31b-${randomUUID()}`);

describe("agent-registry-seed batch31b — parseSeedAgent platform guard", () => {
  beforeEach(() => {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    vi.stubEnv("MEMROOS_SEED_REGISTERED_AGENTS", "1");
    vi.doMock("@/lib/paths", () => ({
      findConfigFile: () => path.join(CONFIG_DIR, "agents.config.json"),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/paths");
    vi.resetModules();
    fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
  });

  it("skips remoteAgents with invalid platform values (lines 85-86)", async () => {
    fs.writeFileSync(
      path.join(CONFIG_DIR, "agents.config.json"),
      JSON.stringify({
        defaultHost: "*",
        remoteAgents: [
          {
            id: "invalid-platform-b31b",
            name: "Invalid",
            role: "Worker",
            platform: "not-listed",
            protocol: "rest",
            location: "local",
          },
          {
            id: "valid-platform-b31b",
            name: "Valid",
            role: "Worker",
            platform: "codex",
            protocol: "rest",
            location: "local",
          },
        ],
      }),
      "utf8",
    );

    const db = new Database(":memory:");
    initSchema(db);
    const { seedRegisteredAgents } = await import("@/lib/agent-registry-seed");
    seedRegisteredAgents(db);
    const ids = db
      .prepare("SELECT id FROM registered_agents ORDER BY id")
      .all()
      .map((row) => (row as { id: string }).id);
    expect(ids).toEqual(["valid-platform-b31b"]);
    db.close();
  });
});
