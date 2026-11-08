// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAgentContextPacket, readAgentRunLedger } from "@/lib/agent-context-packet";
import { initSchema } from "@/lib/db-schema";
import {
  aggregateSourceStatus,
  isSearchAggregateRecalled,
  loadEnabledMeetingCollections,
  searchMeetingCollections,
} from "@/lib/meeting-qmd-recall";
import { validateOkfBundle } from "@/lib/okf";
import {
  addSpaceMember,
  createSpace,
  filterBySpace,
  getSpaceDefaultLabels,
  isSpaceMember,
  resolveSpaceId,
} from "@/lib/space";

describe("long-tail batch14 — lib misc modules", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("space.ts", () => {
    it("handles corrupt default labels and member validation", () => {
      const db = new Database(":memory:");
      initSchema(db);
      db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
      db.prepare(
        `INSERT INTO spaces (id, tenant_id, name, default_labels_json, created_at)
         VALUES ('sp-bad', 'default-tenant', 'Bad Labels', '{not-json', datetime('now'))`,
      ).run();
      expect(getSpaceDefaultLabels(db, "sp-bad")).toEqual({});
      expect(() =>
        addSpaceMember(db, { spaceId: "sp-bad", memberId: "u1", memberType: "bot" as "human" }),
      ).toThrow(/memberType must be/);
      expect(isSpaceMember(db, "", "u1")).toBe(false);
      db.close();
    });

    it("filterBySpace matches legacy project names and resolved ids", () => {
      const rows = [
        { space_id: "sp-1", project: "Alpha" },
        { space_id: null, project: "Alpha" },
        { space_id: "sp-2", project: "Beta" },
      ];
      expect(filterBySpace(rows, "Alpha", "sp-1")).toHaveLength(2);
    });

    it("resolveSpaceId returns null for blank names", () => {
      const db = new Database(":memory:");
      initSchema(db);
      const space = createSpace(db, { tenantId: "default-tenant", name: "Ops" });
      expect(resolveSpaceId(db, "default-tenant", "Ops")).toBe(space.id);
      expect(resolveSpaceId(db, "default-tenant", "   ")).toBeNull();
      db.close();
    });
  });

  describe("okf.ts validateOkfBundle", () => {
    it("flags traversal paths, reserved frontmatter, and broken links", () => {
      const result = validateOkfBundle({
        "../escape.md": "---\ntype: concept\n---\nBody",
        "README.md": "---\nokfVersion: 1\n---\nIndex",
        "index.md": "---\nokfVersion: 1\n---\nIndex",
        "concept/a.md": "---\ntype: concept\n---\nSee [missing](/concept/missing.md)",
      });
      expect(result.conformant).toBe(false);
      expect(result.errors.some((e) => e.code === "invalid_path")).toBe(true);
      expect(result.warnings.some((w) => w.code === "broken_link")).toBe(true);
    });
  });

  describe("meeting-qmd-recall.ts", () => {
    it("loadEnabledMeetingCollections reads config files with home expansion", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `qmd-b14-${crypto.randomUUID()}-`));
      const cfg = path.join(tmp, "meeting-sources.json");
      fs.writeFileSync(
        cfg,
        JSON.stringify({ sources: [{ enabled: true, qmdCollections: ["meetings-alpha"] }] }),
        "utf8",
      );
      const cols = await loadEnabledMeetingCollections(cfg);
      expect(cols).toEqual(["meetings-alpha"]);
    });

    it("searchMeetingCollections normalizes primitive hits and aggregate status", async () => {
      const execFileAsync = vi.fn(async () => ({ stdout: JSON.stringify(["plain-hit"]) }));
      const result = await searchMeetingCollections("budget", 5, ["col-a"], execFileAsync);
      expect(result.hits[0]?.content).toBe("plain-hit");
      expect(isSearchAggregateRecalled(result)).toBe(true);
      const empty = await searchMeetingCollections("   ");
      expect(empty.ok).toBe(false);
      expect(empty.error).toMatch(/query is required/);
    });

    it("aggregateSourceStatus picks weakest provider status", () => {
      const status = aggregateSourceStatus({
        a: { status: "recalled", detail: null },
        b: { status: "provider_absent", detail: "stopped" },
      });
      expect(status).toBe("provider_absent");
    });
  });

  describe("agent-context-packet.ts", () => {
    it("includes skipped trace receipts when policy filters are absent", () => {
      const db = new Database(":memory:");
      initSchema(db);
      const goalId = "goal-b14";
      db.prepare(
        `INSERT INTO agent_memory_traces(id, tenant_id, run_id, task_id, agent_id, causal_path_json, created_at)
         VALUES ('trace-1', 'default-tenant', ?, ?, 'agent-a', '{}', '2026-01-01T00:00:00Z')`,
      ).run(goalId, goalId);
      const packet = buildAgentContextPacket(db, { goalId, actorAgentId: "agent-a" });
      expect(packet.packet.receipts).toContainEqual(
        expect.objectContaining({ source: "agent_memory_traces", status: "skipped" }),
      );
      db.close();
    });

    it("readAgentRunLedger maps handoff packs from context_pack_json", () => {
      const db = new Database(":memory:");
      initSchema(db);
      const goalId = "goal-handoff";
      db.prepare(
        `INSERT INTO agent_handoff_packs(id, tenant_id, task_id, title, context_pack_json, created_at)
         VALUES ('hp-1', 'default-tenant', ?, 'Handoff', ?, '2026-01-01T00:00:00Z')`,
      ).run(goalId, JSON.stringify({ resumeMarker: "resume-42", nextAction: "verify" }));
      const ledger = readAgentRunLedger(db, { goalId });
      expect(ledger.handoffs[0]?.resumeMarker).toBe("resume-42");
      db.close();
    });
  });

});
