// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildAgentContextPacket, readAgentRunLedger } from "@/lib/agent-context-packet";
import {
  asGsdLane,
  createOrResumeGsdGoal,
  gsdInputFromJson,
  gsdStringArray,
  runGsdShipcheck,
} from "@/lib/agent-gsd-control";
import {
  authorizeChatGptAction,
  decodeChatGptActionResult,
  parseActionLimit,
  readJsonBody,
} from "@/lib/chatgpt-actions";
import { projectMemoryToGraph } from "@/lib/memory/graph-catchup";

const db = new Database(":memory:");
initSchema(db);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("long-tail batch19b lib — agent context + gsd control", () => {
  it("buildAgentContextPacket assembles ledger-linked goal context", () => {
    const goalId = `goal-${randomUUID().slice(0, 8)}`;
    const built = buildAgentContextPacket(db, {
      goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
      goalTitle: "Ship feature",
      acceptanceCriteria: ["tests pass"],
    });
    expect(built.packet.goal.id).toBe(goalId);
    expect(built.packet.goal.lane).toBe("code");
    expect(built.packet.packetHash).toMatch(/^sha256:/);
    expect(built.ledger.goalId).toBe(goalId);
  });

  it("createOrResumeGsdGoal and runGsdShipcheck enforce lane proof", () => {
    const goal = createOrResumeGsdGoal(db, {
      title: "GSD batch19b",
      actorAgentId: "codex-cli-agent",
      lane: "code",
      acceptanceCriteria: ["unit tests"],
    });
    expect(goal.goalId).toBeTruthy();
    const ledger = readAgentRunLedger(db, { goalId: goal.goalId });
    expect(ledger.goalId).toBe(goal.goalId);

    const blocked = runGsdShipcheck(db, {
      goalId: goal.goalId,
      actorAgentId: "codex-cli-agent",
      lane: "code",
      proof: {},
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.missingProof).toContain("focused_tests");
  });

  it("gsd helpers normalize lane and json inputs", () => {
    expect(asGsdLane("memory")).toBe("memory");
    expect(asGsdLane("not-a-lane")).toBeUndefined();
    expect(gsdStringArray(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(gsdInputFromJson({ ok: true }).ok).toBe(true);
    expect(gsdInputFromJson("bad")).toEqual({});
  });
});

describe("long-tail batch19b lib — chatgpt actions + graph projection", () => {
  it("authorizeChatGptAction rejects missing bearer on non-loopback hosts", () => {
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "chatgpt-actions-test-key-32chars!!";
    const res = authorizeChatGptAction(
      new Request("https://example.com/api/chatgpt/actions/search", {
        headers: { host: "example.com" },
      }),
    );
    expect(res?.status).toBe(401);
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
  });

  it("parseActionLimit clamps invalid values and decodeChatGptActionResult round-trips", () => {
    expect(parseActionLimit("999", 8)).toBe(20);
    expect(parseActionLimit(undefined, 5)).toBe(5);
    const id = `memroos:${Buffer.from(
      JSON.stringify({
        title: "Note",
        text: "Body",
        tier: "vector",
        source: "mem0",
        label: { visibility: "internal", policy: "agent_visible" },
      }),
      "utf8",
    ).toString("base64url")}`;
    const decoded = decodeChatGptActionResult(id);
    expect(decoded.text).toBe("Body");
  });

  it("readJsonBody returns empty object for blank bodies", async () => {
    const body = await readJsonBody(new Request("http://localhost/api", { method: "POST", body: "" }));
    expect(body).toEqual({});
  });

  it("projectMemoryToGraph skips whitespace-only episodic content", () => {
    const preview = projectMemoryToGraph({ id: "m-empty", content: "  \n\t" });
    expect(preview.skipped).toBe(true);
    expect(preview.reason).toBe("empty_content");
  });
});
