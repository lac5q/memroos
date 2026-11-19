// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelRemoteA2aTask, redactUrlForDisplay, sendMessageToA2aAgent } from "@/lib/a2a/client";
import type { DispatchTask } from "@/lib/dispatch/types";
import { createQuickBooksAdapter } from "@/lib/l3/adapters/quickbooks";
import { parseAgents } from "@/lib/parsers";
import { exportSkillPackage, importSkillPackage, syncSkillsWithAgent, type SkillPackage } from "@/lib/skillforge/multi-agent";

const LOOPBACK = "http://localhost";

function sampleTask(): DispatchTask {
  return {
    task_id: `task-${crypto.randomUUID()}`,
    context_id: "ctx-1",
    task_summary: "Run batch14b integration check",
    from_agent: "memroos",
    to_agent: "remote",
    priority: 5,
    dispatched_at: new Date().toISOString(),
    input: { mode: "test" },
  };
}

describe("integrations batch14b — a2a, quickbooks, skillforge, parsers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redactUrlForDisplay strips credentials from malformed urls", () => {
    expect(redactUrlForDisplay(`${LOOPBACK}:8080/path`)).toContain("localhost");
    expect(redactUrlForDisplay("not-a-url://user:pass@host")).toBe("not-a-url://host");
  });

  it("sendMessageToA2aAgent posts to localhost message:send override", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ task: { id: "remote-task", status: { state: "working" } } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const agent = {
      id: "remote",
      host: "localhost",
      port: 9000,
      metadata: { a2a: { messageSendUrl: `${LOOPBACK}:9000/custom/send` } },
    };
    const result = await sendMessageToA2aAgent(agent, sampleTask(), { timeoutMs: 500 });
    expect(result.accepted).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${LOOPBACK}:9000/custom/send`);
  });

  it("cancelRemoteA2aTask surfaces HTTP errors from localhost", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const agent = { id: "remote", host: "localhost", port: 7001, metadata: { a2a: { endpointUrl: `${LOOPBACK}:7001` } } };
    const result = await cancelRemoteA2aTask(agent, "task-404", { timeoutMs: 500 });
    expect(result.accepted).toBe(false);
    expect(result.detail).toMatch(/503/);
  });

  it("createQuickBooksAdapter mock mode returns fixture finance events", async () => {
    const adapter = createQuickBooksAdapter({ mock: true });
    const events = await adapter.poll(new Date("2026-01-01T00:00:00Z"));
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.adapter === "quickbooks")).toBe(true);
  });

  it("multi-agent export/import/sync against skill_registry", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE skill_registry (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL,
        version TEXT, author TEXT, tags TEXT, imported_at TEXT
      );
      CREATE TABLE eval_receipts (
        id INTEGER PRIMARY KEY, skill_id TEXT, provider TEXT, model TEXT,
        dimensions TEXT, timestamp TEXT
      );
      CREATE TABLE skill_sync_log (
        id INTEGER PRIMARY KEY, skill_id TEXT, target_agent TEXT,
        package_id TEXT, status TEXT, timestamp TEXT
      );
    `);
    db.prepare(
      `INSERT INTO skill_registry (id, name, content, version, author, tags, imported_at)
       VALUES (1, 'Test Skill', '# Skill', '1.0.0', 'operator', '["test"]', datetime('now'))`,
    ).run();
    db.prepare(
      `INSERT INTO eval_receipts (skill_id, provider, model, dimensions, timestamp)
       VALUES ('1', 'openai', 'gpt-test', ?, datetime('now'))`,
    ).run(JSON.stringify({ accuracy: 0.9, safety: 0.95 }));
    const exported = exportSkillPackage(db, "1");
    expect(exported.success).toBe(true);
    expect(exported.package?.compatibility).toContain("memroos");

    const pkg = exported.package as SkillPackage;
    const imported = importSkillPackage(db, {
      ...pkg,
      skillId: "99",
      metadata: {
        ...pkg.metadata,
        evalReceipts: [
          {
            provider: "openai",
            model: "gpt-test",
            dimensions: { accuracy: 0.9, safety: 0.95 },
            timestamp: new Date().toISOString(),
          },
        ],
      },
    });
    expect(imported.validationPassed).toBe(true);
    expect(imported.success).toBe(true);

    const sync = syncSkillsWithAgent(db, `${LOOPBACK}/a2a/skills`, ["1"]);
    expect(sync.synced).toBe(1);
    db.close();
  });

  it("parseAgents reads HEARTBEAT markers from a temp agent directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `agents-parse-${crypto.randomUUID()}-`));
    const agentDir = path.join(root, "hermes-agent");
    fs.mkdirSync(agentDir);
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "STATUS: active\nPopSmiths ops", "utf8");
    fs.writeFileSync(path.join(agentDir, "HEARTBEAT_STATE.md"), "# Investigate checkout\n", "utf8");
    const agents = await parseAgents(root);
    expect(agents[0]?.id).toBe("hermes-agent");
    expect(agents[0]?.company).toBe("PopSmiths");
    expect(agents[0]?.currentTask).toMatch(/Investigate checkout/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
