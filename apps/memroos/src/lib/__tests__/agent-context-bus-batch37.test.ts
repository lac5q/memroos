// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  ensureAgentContextBusSchema,
  postAgentContextMessage,
  replyToAgentContextMessage,
} from "@/lib/agent-context-bus";

function seedDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  ensureAgentContextBusSchema(db);
  db.prepare(
    `INSERT INTO registered_agents(id, name, role, platform, protocol, status)
     VALUES(?, ?, ?, 'codex', 'rest', 'active')`,
  ).run("agent-a-b37", "Agent A", "Sender");
  db.prepare(
    `INSERT INTO registered_agents(id, name, role, platform, protocol, status)
     VALUES(?, ?, ?, 'codex', 'rest', 'active')`,
  ).run("agent-b-b37", "Agent B", "Recipient");
  return db;
}

describe("agent-context-bus batch37", () => {
  it("replyToAgentContextMessage rejects unknown message id (335)", () => {
    const db = seedDb();
    expect(() =>
      replyToAgentContextMessage(db, "missing-msg-b37", {
        fromAgent: "agent-b-b37",
        body: "noop",
      }),
    ).toThrow(/Unknown agent context message/);
    db.close();
  });

  it("replyToAgentContextMessage rejects non-addressed replier before line 335", () => {
    const db = seedDb();
    const message = postAgentContextMessage(db, {
      fromAgent: "agent-a-b37",
      toAgent: "agent-b-b37",
      messageType: "request",
      subject: "b37",
      body: "context",
    });
    expect(() =>
      replyToAgentContextMessage(db, message.id, {
        fromAgent: "agent-a-b37",
        body: "wrong agent",
      }),
    ).toThrow(/Only the addressed agent can reply/);
    db.close();
  });
});