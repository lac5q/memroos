// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const TMP = path.join(os.tmpdir(), `agent-seed-msiq-b22c-${crypto.randomUUID()}`);

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  process.env.MEMROOS_ROOT = TMP;
  process.env.MEMROOS_SEED_REGISTERED_AGENTS = "1";
});

afterEach(() => {
  delete process.env.MEMROOS_HOST_ID;
  delete process.env.MEMROOS_SEED_REGISTERED_AGENTS;
  delete process.env.MEMROOS_ROOT;
  fs.rmSync(TMP, { recursive: true, force: true });
  vi.resetModules();
});

describe("agent-registry-seed + msiq scope-identity batch22c", () => {
  it("seedRegisteredAgents filters invalid agents and host defaults", async () => {
    const configDir = path.join(TMP, "config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "agents.config.json"),
      JSON.stringify({
        defaultHost: "other-host",
        remoteAgents: [
          null,
          { id: "", name: "Bad", role: "r", platform: "cursor" },
          { id: "good-agent", name: "Good", role: "worker", platform: "cursor" },
        ],
      }),
      "utf8",
    );
    vi.doMock("@/lib/paths", () => ({
      findConfigFile: () => path.join(configDir, "agents.config.json"),
    }));
    process.env.MEMROOS_HOST_ID = "oracle-1";
    const db = new Database(":memory:");
    initSchema(db);
    const { seedRegisteredAgents } = await import("../agent-registry-seed");
    seedRegisteredAgents(db);
    expect(db.prepare(`SELECT COUNT(*) as c FROM registered_agents`).get()).toEqual({ c: 0 });

    fs.writeFileSync(
      path.join(configDir, "agents.config.json"),
      JSON.stringify({
        defaultHost: "oracle-1",
        remoteAgents: [{ id: "host-agent", name: "Host Agent", role: "worker", platform: "cursor" }],
      }),
      "utf8",
    );
    vi.resetModules();
    vi.doMock("@/lib/paths", () => ({
      findConfigFile: () => path.join(configDir, "agents.config.json"),
    }));
    const { seedRegisteredAgents: seedAgain } = await import("../agent-registry-seed");
    seedAgain(db);
    expect(db.prepare(`SELECT id FROM registered_agents`).all()).toEqual([{ id: "host-agent" }]);
    db.close();
  });

  it("normalizeScopeIdentity and isCompleteScopeIdentity reject invalid labels and incomplete payloads", async () => {
    const {
      normalizeScopeIdentity,
      isCompleteScopeIdentity,
      hashScopeIdentity,
      buildScopeIdentity,
    } = await import("../msiq/scope-identity");
    expect(
      normalizeScopeIdentity({
        tenantId: "t1",
        userId: "u1",
        agentId: "a1",
        spaceId: "s1",
        label: { visibility: "not-real" as never, policy: "sealed" },
        purpose: "dispatch",
        beliefStage: "silver_candidate_claim",
      }),
    ).toBeNull();
    expect(
      normalizeScopeIdentity({
        tenantId: "t1",
        userId: "u1",
        agentId: "a1",
        spaceId: "s1",
        label: { visibility: "private", policy: "not-real" as never },
        purpose: "dispatch",
        beliefStage: "silver_candidate_claim",
      }),
    ).toBeNull();

    expect(isCompleteScopeIdentity({ tenantId: "t1" })).toBe(false);
    expect(
      isCompleteScopeIdentity({
        tenantId: "t1",
        userId: "u1",
        agentId: "a1",
        spaceId: "s1",
        label: { visibility: "private" },
        purpose: "dispatch",
        beliefStage: "silver_candidate_claim",
      }),
    ).toBe(false);

    const built = buildScopeIdentity({
      actor: { id: "u1", role: "operator", tenantId: "t1", capability: "agent-1" },
      spaceId: "s1",
      label: { visibility: "private", policy: "sealed" },
      purpose: "dispatch",
    });
    expect(built).not.toBeNull();
    expect(hashScopeIdentity(built!)).toMatch(/^sha256:/);

    const ordered = hashScopeIdentity({
      tenantId: "t1",
      userId: "u1",
      agentId: "a1",
      spaceId: "s1",
      label: { visibility: "private", policy: "sealed", domain: null, sensitivity: null },
      purpose: "dispatch",
      beliefStage: "silver_candidate_claim",
    });
    expect(ordered).toMatch(/^sha256:/);
  });
});
