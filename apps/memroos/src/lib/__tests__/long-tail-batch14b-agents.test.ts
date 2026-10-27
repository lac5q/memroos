// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_CONTEXT_MESSAGE_TYPES,
  AGENT_CONTEXT_STATUSES,
  ensureAgentContextBusSchema,
  isAgentContextMessageType,
  isAgentContextStatus,
  listAgentContextMessages,
  postAgentContextMessage,
  replyToAgentContextMessage,
} from "@/lib/agent-context-bus";
import { initSchema } from "@/lib/db-schema";
import {
  buildDelegationChain,
  verifyDelegationChain,
  weakestLinkOutcome,
} from "@/lib/identity/delegation";

const TEST_DB_DIR = path.join(os.tmpdir(), `agent-batch14b-${crypto.randomUUID()}`);
const TEST_DB_PATH = path.join(TEST_DB_DIR, "agents.db");

async function loadRegistry() {
  process.env.SQLITE_DB_PATH = TEST_DB_PATH;
  vi.resetModules();
  const dbModule = await import("@/lib/db");
  const registryModule = await import("@/lib/agent-registry");
  return { ...registryModule, closeDb: dbModule.closeDb };
}

function seedAgentsDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  ensureAgentContextBusSchema(db);
  db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash)
     VALUES ('user-1', 'user-1@test.com', 'User One', 'hash')`,
  ).run();
  const insert = db.prepare(
    `INSERT INTO registered_agents(id, name, role, platform, protocol, status, owner_id, metadata)
     VALUES(?, ?, ?, 'codex', 'rest', 'active', ?, ?)`,
  );
  insert.run("agent-parent", "Parent", "Lead", "user-1", "{}");
  insert.run("agent-child", "Child", "Worker", "user-1", JSON.stringify({ parent_agent_id: "agent-parent" }));
  insert.run("agent-alpha", "Alpha", "Sender", null, "{}");
  insert.run("agent-beta", "Beta", "Recipient", null, "{}");
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES ('user-1', 'admin')`).run();
  db.prepare(
    `INSERT INTO agent_capabilities (agent_id, capability_id, name, description, tags, updated_at)
     VALUES ('agent-parent', 'dispatch', 'Dispatch', 'Dispatch tasks', '[]', datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO agent_capabilities (agent_id, capability_id, name, description, tags, updated_at)
     VALUES ('agent-child', 'memory.read', 'Memory Read', 'Read memory', '[]', datetime('now'))`,
  ).run();
  return db;
}

describe("agents batch14b — context bus, delegation, registry", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  });

  afterEach(async () => {
    const { closeDb } = await loadRegistry();
    closeDb();
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    delete process.env.SQLITE_DB_PATH;
    vi.unstubAllGlobals();
  });

  describe("agent-context-bus.ts", () => {
    it("type guards recognize configured enums", () => {
      expect(isAgentContextMessageType("request")).toBe(true);
      expect(isAgentContextMessageType("bogus")).toBe(false);
      expect(isAgentContextStatus("pending")).toBe(true);
      expect(AGENT_CONTEXT_MESSAGE_TYPES).toContain("knowledge_save");
      expect(AGENT_CONTEXT_STATUSES).toContain("failed");
    });

    it("clamps priority and list limit when posting messages", () => {
      const db = seedAgentsDb();
      const msg = postAgentContextMessage(db, {
        fromAgent: "agent-alpha",
        toAgent: "agent-beta",
        body: "high priority ping",
        priority: 99,
      });
      expect(msg.priority).toBe(9);
      for (let i = 0; i < 5; i++) {
        postAgentContextMessage(db, {
          fromAgent: "agent-alpha",
          toAgent: "agent-beta",
          body: `bulk-${i}`,
        });
      }
      const inbox = listAgentContextMessages(db, { agentId: "agent-beta", limit: 3 });
      expect(inbox.length).toBeLessThanOrEqual(3);
      db.close();
    });

    it("replyToAgentContextMessage rejects wrong replier", () => {
      const db = seedAgentsDb();
      const message = postAgentContextMessage(db, {
        fromAgent: "agent-alpha",
        toAgent: "agent-beta",
        body: "need help",
      });
      expect(() =>
        replyToAgentContextMessage(db, message.id, {
          fromAgent: "agent-alpha",
          body: "self reply",
        }),
      ).toThrow(/Only the addressed agent/);
      db.close();
    });

    it("parses corrupt context_refs and artifacts as empty containers", () => {
      const db = seedAgentsDb();
      db.prepare(
        `INSERT INTO agent_context_messages (
           id, thread_id, correlation_id, parent_id, from_agent, to_agent, message_type,
           status, priority, subject, body, context_refs, artifacts, visibility, policy,
           reply_required, saved_memory_id, created_at, updated_at, expires_at
         ) VALUES (
           'acm_manual', 'thread_x', 'corr_x', NULL, 'agent-alpha', 'agent-beta', 'message',
           'pending', 5, NULL, 'body', '{bad', '{bad', 'internal', 'agent_visible',
           0, NULL, datetime('now'), datetime('now'), NULL
         )`,
      ).run();
      const listed = listAgentContextMessages(db, { threadId: "thread_x" });
      expect(listed[0]?.contextRefs).toEqual([]);
      expect(listed[0]?.artifacts).toEqual({});
      db.close();
    });
  });

  describe("identity/delegation.ts", () => {
    it("buildDelegationChain includes sub-agent hop when parent metadata matches", () => {
      const db = seedAgentsDb();
      const chain = buildDelegationChain(db, "user-1", "agent-parent", "agent-child");
      expect(chain?.subAgent?.id).toBe("agent-child");
      expect(chain?.hops).toHaveLength(2);
      expect(verifyDelegationChain(chain!).valid).toBe(true);
      db.close();
    });

    it("buildDelegationChain returns null when owner_id mismatches user", () => {
      const db = seedAgentsDb();
      expect(buildDelegationChain(db, "user-2", "agent-parent")).toBeNull();
      db.close();
    });

    it("weakestLinkOutcome denies on any deny and fails closed on missing hop outcomes", () => {
      const db = seedAgentsDb();
      const chain = buildDelegationChain(db, "user-1", "agent-parent", "agent-child")!;
      expect(weakestLinkOutcome(chain, [{ hopIndex: 0, outcome: "allow" }])).toBe("deny");
      expect(weakestLinkOutcome(chain, [{ hopIndex: 0, outcome: "deny" }])).toBe("deny");
      expect(
        weakestLinkOutcome(chain, [
          { hopIndex: 0, outcome: "allow" },
          { hopIndex: 1, outcome: "allow" },
        ]),
      ).toBe("allow");
      db.close();
    });
  });

  describe("agent-registry.ts remote helpers", () => {
    it("getRemoteAgents maps a2a metadata endpointUrl to host/port", async () => {
      const { registerAgent, getRemoteAgents } = await loadRegistry();
      registerAgent({
        id: "remote-a2a",
        name: "Remote A2A",
        role: "Worker",
        platform: "codex",
        protocol: "a2a",
        location: "cloudflare",
        host: null,
        port: null,
        tunnelUrl: "http://localhost:8787",
        metadata: { a2a: { endpointUrl: "http://localhost:8787/a2a" } },
      });
      const remotes = getRemoteAgents();
      expect(remotes.some((r) => r.id === "remote-a2a" && r.host === "localhost")).toBe(true);
    });

    it("pollRemoteAgent hits http://localhost health endpoint", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: "ok" }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      const { registerAgent, getRemoteAgents, pollRemoteAgent } = await loadRegistry();
      registerAgent({
        id: "local-remote",
        name: "Local Remote",
        role: "Worker",
        platform: "codex",
        protocol: "rest",
        location: "tailscale",
        host: "localhost",
        port: 8080,
        healthEndpoint: "/health",
      });
      const agent = getRemoteAgents().find((r) => r.id === "local-remote");
      expect(agent).toBeTruthy();
      const result = await pollRemoteAgent(agent!);
      expect(result.reachable).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/health", expect.any(Object));
    });
  });
});
