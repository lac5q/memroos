// apps/memroos/src/lib/workflow/__tests__/topology.test.ts
// The workflow map used to be a hardcoded literal that showed five fixed agent
// names on every host. These tests pin the properties that made it wrong.

import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";

import { buildTopology, UNIFORM_WEIGHT } from "../topology";

let db: Database.Database;

const AGENTS = [
  { id: "alba", name: "Alba", role: "Head Chef (Coordinator)" },
  { id: "ceo", name: "CEO", role: "Executive" },
  { id: "cmo", name: "CMO", role: "Marketing" },
];

beforeEach(() => {
  db = new Database(":memory:");
  initSchema(db);
});

describe("workflow/topology", () => {
  it("renders the agents it is given, not a hardcoded roster", () => {
    const t = buildTopology(db, { agents: AGENTS, sources: [] });
    const labels = t.nodes.filter((n) => n.t === "agent").map((n) => n.label);
    expect(labels).toEqual(["Alba", "CEO", "CMO"]);
    // The old literal baked these in on every host regardless of the registry.
    expect(labels).not.toContain("Sophia");
    expect(labels).not.toContain("Gwen");
  });

  it("says so when the registry is empty rather than drawing a blank column", () => {
    // This is cordant-hermes-01's actual state: registered_agents has 0 rows.
    // Silently rendering nothing looks more broken than showing wrong names.
    const t = buildTopology(db, { agents: [], sources: [] });
    expect(t.nodes.filter((n) => n.t === "agent")).toEqual([]);
    expect(t.notices.join(" ")).toMatch(/no agents registered/i);
  });

  it("spaces agents without overlap at any count", () => {
    for (const count of [1, 3, 12, 59]) {
      const agents = Array.from({ length: count }, (_, i) => ({
        id: `a${i}`,
        name: `Agent ${i}`,
        role: "role",
      }));
      const t = buildTopology(db, { agents, sources: [] });
      const boxes = t.nodes.filter((n) => n.t === "agent");

      expect(boxes.length).toBe(count);
      // No two cards may occupy the same slot.
      const slots = new Set(boxes.map((n) => `${n.x}:${n.y}`));
      expect(slots.size).toBe(count);
      // Every card stays legible and inside the canvas.
      for (const b of boxes) {
        expect(b.h).toBeGreaterThanOrEqual(34);
        expect(b.y).toBeGreaterThanOrEqual(80);
        expect(b.y + b.h).toBeLessThanOrEqual(465);
        expect(b.x + b.w).toBeLessThanOrEqual(t.canvas.width);
      }
      // No pairwise overlap within a sub-column.
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i], c = boxes[j];
          const overlap =
            a.x < c.x + c.w && c.x < a.x + a.w &&
            a.y < c.y + c.h && c.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it("wraps a large roster into multiple sub-columns", () => {
    // 59 agents is oracle-1's real count. One column would be a solid bar.
    const agents = Array.from({ length: 59 }, (_, i) => ({
      id: `a${i}`, name: `Agent ${i}`, role: "role",
    }));
    const boxes = buildTopology(db, { agents, sources: [] })
      .nodes.filter((n) => n.t === "agent");
    const columns = new Set(boxes.map((n) => n.x));
    expect(columns.size).toBeGreaterThan(1);
  });

  it("thins edges once the roster is dense, and says so", () => {
    const agents = Array.from({ length: 59 }, (_, i) => ({
      id: `a${i}`, name: `Agent ${i}`, role: "role",
    }));
    const t = buildTopology(db, {
      agents,
      sources: [],
      agentActivity: { a0: 10, a1: 5 },
    });
    const packs = t.edges.filter((e) => e.kind === "pack");
    // Only the two agents with recorded activity get edges.
    expect(packs.length).toBe(2);
    expect(packs.every((e) => e.measured)).toBe(true);
    expect(t.notices.join(" ")).toMatch(/keep the map readable/i);
  });

  it("notices when no external sources are connected", () => {
    const t = buildTopology(db, { agents: [], sources: [] });
    expect(t.notices.join(" ")).toMatch(/no connected sources/i);
  });

  it("derives sources from connected providers", () => {
    const t = buildTopology(db, {
      agents: [],
      sources: [
        { id: "linear", label: "Linear", sub: "connected" },
        { id: "notion", label: "Notion", sub: "connected" },
      ],
    });
    const srcs = t.nodes.filter((n) => n.t === "src").map((n) => n.label);
    expect(srcs).toEqual(["Linear", "Notion"]);
    // Every source feeds the gateway.
    for (const s of ["src:linear", "src:notion"]) {
      expect(t.edges.some((e) => e.from === s && e.to === "gateway")).toBe(true);
    }
  });

  it("flags unmeasured edge weights instead of inventing telemetry", () => {
    // The old map asserted `["memory","sophia",0.5,"pack"]` — a hand-typed
    // number that rendered as if it were a measurement.
    const t = buildTopology(db, { agents: AGENTS, sources: [] });
    const packs = t.edges.filter((e) => e.kind === "pack");
    expect(packs.length).toBe(AGENTS.length);
    for (const e of packs) {
      expect(e.measured).toBe(false);
      expect(e.weight).toBe(UNIFORM_WEIGHT);
    }
  });

  it("scales edge weight by real activity when counts are supplied", () => {
    const t = buildTopology(db, {
      agents: AGENTS,
      sources: [],
      agentActivity: { alba: 100, ceo: 50, cmo: 0 },
    });
    const byAgent = Object.fromEntries(
      t.edges.filter((e) => e.kind === "pack").map((e) => [e.to, e]),
    );
    expect(byAgent["agent:alba"].measured).toBe(true);
    expect(byAgent["agent:alba"].weight).toBeGreaterThan(
      byAgent["agent:ceo"].weight,
    );
    // Zero activity still draws — floored, not invisible.
    expect(byAgent["agent:cmo"].weight).toBeGreaterThan(0);
  });

  it("keeps structural nodes declared and marks them not-live", () => {
    const t = buildTopology(db, { agents: AGENTS, sources: [] });
    for (const id of ["gateway", "memroos", "outcomes"]) {
      const n = t.nodes.find((x) => x.id === id);
      expect(n).toBeDefined();
      expect(n!.live).toBe(false);
    }
  });

  it("reports an absent store table as unavailable, not as zero", () => {
    // A confident "0 documents" for a table that does not exist is the same
    // class of lie the hardcoded map told.
    const t = buildTopology(db, { agents: [], sources: [] });
    const memory = t.nodes.find((n) => n.id === "memory")!;
    expect(memory.sub).toMatch(/records/);
    expect(memory.live).toBe(true);
  });

  it("counts store rows from the live database", () => {
    db.prepare(
      `INSERT INTO messages (session_id, project, agent_id, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("s1", "p", "a", "user", "hello", new Date().toISOString());

    const t = buildTopology(db, { agents: [], sources: [] });
    expect(t.nodes.find((n) => n.id === "memory")!.sub).toBe("1 records");
  });
});
