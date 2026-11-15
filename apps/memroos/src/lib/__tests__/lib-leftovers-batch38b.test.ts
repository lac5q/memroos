// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { recordCronHealthRun } from "@/lib/cron-health";
import { hasValidUnderstandGraphToken } from "@/lib/understand-graph";
import { authenticateTenantRequest } from "@/lib/public-api/auth";
import { checkDispatchPolicy } from "@/lib/security-policy";
import { loadWikiGraph } from "@/lib/wiki-graph";
import { createResponseCache } from "@/lib/response-cache";
import { generateKeyPair, verifySkill } from "@/lib/skills/skill-signing";

describe("lib leftovers batch38b", () => {
  const wikiRoots: string[] = [];

  afterEach(() => {
    delete process.env.UNDERSTAND_GRAPH_TOKEN;
    delete process.env.MEMROOS_A2A_PROFILE;
    delete process.env.MEMROOS_A2A_ALLOW_PRIVATE_NETWORK_CARDS;
    vi.restoreAllMocks();
    for (const root of wikiRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    wikiRoots.length = 0;
  });

  it("hasValidUnderstandGraphToken is false without configured token (understand-graph 26)", () => {
    delete process.env.UNDERSTAND_GRAPH_TOKEN;
    expect(
      hasValidUnderstandGraphToken(new Request("http://localhost:3000/understand/graph")),
    ).toBe(false);
  });

  it("authenticateTenantRequest rejects empty Bearer token (public-api/auth 50)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(
      authenticateTenantRequest(
        new Request("http://localhost:3000/api/public", {
          headers: { authorization: "Bearer   " },
        }),
        db,
      ),
    ).toBeNull();
    db.close();
  });

  it("checkDispatchPolicy denies loopback targets when private cards disallowed (security-policy 52)", () => {
    process.env.MEMROOS_A2A_PROFILE = "cloud-https";
    process.env.MEMROOS_A2A_ALLOW_PRIVATE_NETWORK_CARDS = "0";
    const decision = checkDispatchPolicy("caller-b38b", {
      id: "remote-b38b",
      name: "Remote",
      role: "Worker",
      platform: "codex",
      protocol: "rest",
      host: "localhost",
      skills: [],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("NETWORK_POLICY_DENIED");
  });

  it("loadWikiGraph skips nodes with empty id (wiki-graph 70)", () => {
    const wikiRoot = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-b38b-${randomUUID()}-`));
    wikiRoots.push(wikiRoot);
    const graphDir = path.join(wikiRoot, "graph");
    fs.mkdirSync(graphDir, { recursive: true });
    fs.writeFileSync(
      path.join(graphDir, "knowledge-graph.json"),
      JSON.stringify({
        generatedAt: "2026-11-15T00:00:00.000Z",
        nodes: [{ id: "", label: "skip-me" }, { id: "keep-b38b", label: "Keep" }],
        edges: [],
      }),
      "utf8",
    );
    const graph = loadWikiGraph({ wikiRoot });
    expect(graph.nodes).toEqual([{ id: "keep-b38b", label: "Keep", path: undefined }]);
  });

  it("verifySkill catch returns false when crypto.verify throws (skill-signing 166)", () => {
    const { publicKey } = generateKeyPair();
    vi.spyOn(crypto, "verify").mockImplementation(() => {
      throw new Error("verify boom b38b");
    });
    expect(verifySkill(publicKey, hashSkillPlaceholder(), "c2ln")).toBe(false);
  });

  it("recordCronHealthRun tolerates empty and invalid metadata_json (cron-health 94, 100)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(
      `INSERT INTO cron_health_jobs
        (id, name, source_family, schedule, owner, status, expected_interval_minutes, metadata_json, updated_at)
       VALUES ('job-b38b', 'Batch38b Job', 'test', 'manual', 'operator', 'active', 60, '', datetime('now'))`,
    ).run();
    const emptyMeta = recordCronHealthRun(db, "job-b38b", {
      success: true,
      metadata: { lane: "b38b" },
    });
    expect(emptyMeta?.metadata).toMatchObject({ lane: "b38b" });

    db.prepare(`UPDATE cron_health_jobs SET metadata_json = ? WHERE id = 'job-b38b'`).run("{bad");
    const badMeta = recordCronHealthRun(db, "job-b38b", {
      success: false,
      metadata: { repaired: true },
    });
    expect(badMeta?.metadata).toMatchObject({ repaired: true });
    db.close();
  });

  it("createResponseCache evicts oldest entries when over maxEntries (response-cache 43–44)", async () => {
    const cache = createResponseCache({ maxEntries: 1 });
    await cache.getOrSet("ns", "a", 60_000, () => "first");
    await cache.getOrSet("ns", "b", 60_000, () => "second");
    const stats = cache.stats();
    expect(stats.entries).toBe(1);
    expect(stats.evictions).toBeGreaterThanOrEqual(1);
  });

  it.skip("createResponseCache oldest undefined guard (response-cache 42) — sticky when size > maxEntries", () => {});
});

function hashSkillPlaceholder(): string {
  return crypto.createHash("sha256").update("batch38b-skill").digest("hex");
}