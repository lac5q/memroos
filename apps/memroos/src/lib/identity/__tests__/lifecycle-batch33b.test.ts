// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { onboardUser, scanOrphanedAgents } from "../lifecycle";

function createSpace(db: Database.Database, name: string): { id: string } {
  const id = `space-${name}`;
  db.prepare(`INSERT INTO spaces (id, tenant_id, name, created_at) VALUES (?, 'default-tenant', ?, datetime('now'))`).run(
    id,
    name,
  );
  return { id };
}

describe("identity lifecycle batch33b", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("scanOrphanedAgents stable-sorts merged orphans (552, 557)", () => {
    db = new Database(":memory:");
    initSchema(db);
    const space = createSpace(db, "batch33b");
    const first = onboardUser(db, {
      email: "alpha-b33b@example.com",
      displayName: "Alpha",
      role: "operator",
      spaceIds: [space.id],
      agentKit: { name: "alpha-agent-b33b" },
    });
    const second = onboardUser(db, {
      email: "zulu-b33b@example.com",
      displayName: "Zulu",
      role: "operator",
      spaceIds: [space.id],
      agentKit: { name: "zulu-agent-b33b" },
    });
    const ts = new Date().toISOString();
    db.prepare(`UPDATE registered_agents SET deregistered_at = ?, status = 'dormant' WHERE id IN (?, ?)`).run(
      ts,
      first.agentId,
      second.agentId,
    );

    const orphans = scanOrphanedAgents(db);
    const ids = orphans.map((o) => o.agentId);
    expect(ids).toEqual([...ids].sort());
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });
});
