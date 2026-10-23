// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

const testDb = new Database(":memory:");
const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const telemetryRoute = await import("../telemetry/route");
const recommendationsRoute = await import("../recommendations/route");
const evalsRoute = await import("../evals/route");

function postRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("model routing APIs", () => {
  beforeEach(() => {
    testDb.exec("DROP TABLE IF EXISTS model_routing_events");
    testDb.exec("DELETE FROM efficiency_events");
  });

  it("GET telemetry tolerates corrupt stored context_tags JSON", async () => {
    const { ensureModelRoutingSchema } = await import("@/lib/model-routing");
    ensureModelRoutingSchema(testDb);
    testDb.prepare(
      `INSERT INTO model_routing_events
        (task_type, agent_id, provider, model, strategy, latency_ms, input_tokens, output_tokens,
         estimated_cost_usd, success, quality_score, context_tags, prompt_hash, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "engineering",
      null,
      "openai",
      "gpt-5.4-mini",
      "balanced",
      null,
      0,
      0,
      null,
      1,
      null,
      "{bad-tags",
      null,
      null,
      new Date().toISOString()
    );

    const res = await telemetryRoute.GET(
      new Request("http://localhost/api/model-routing/telemetry?limit=5") as any
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.events[0].contextTags).toEqual([]);
  });

  it("GET telemetry returns recent events and summary", async () => {
    await telemetryRoute.POST(
      postRequest("http://localhost/api/model-routing/telemetry", {
        taskType: "engineering",
        provider: "openai",
        model: "gpt-5.4-mini",
      }) as any
    );

    const res = await telemetryRoute.GET(
      new Request("http://localhost/api/model-routing/telemetry?limit=5") as any
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.events.length).toBeGreaterThan(0);
    expect(data.summary.totalRuns).toBeGreaterThan(0);
    expect(data.timestamp).toBeTruthy();
  });

  it("POST telemetry returns 400 when required fields are missing", async () => {
    const res = await telemetryRoute.POST(
      postRequest("http://localhost/api/model-routing/telemetry", {
        taskType: "engineering",
        provider: "openai",
      }) as any
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/taskType, provider, and model are required/i);
  });

  it("blocks direct non-local telemetry writes without operator authorization", async () => {
    const res = await telemetryRoute.POST(
      postRequest("https://memroos.example.com/api/model-routing/telemetry", {
        taskType: "engineering",
        provider: "openai",
        model: "gpt-5.4-mini",
      }) as any
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "Registry write authorization required",
    });
  });

  it("records telemetry without storing raw prompts", async () => {
    const res = await telemetryRoute.POST(
      postRequest("http://localhost/api/model-routing/telemetry", {
        taskType: "engineering",
        agentId: "codex",
        provider: "openai",
        model: "gpt-5.4-mini",
        prompt: "sensitive task context",
        inputTokens: 1000,
        outputTokens: 500,
        success: true,
        qualityScore: 0.8,
      }) as any
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.event.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain("sensitive task context");
  });

  it("emits token_ledger telemetry from model-routing token accounting", async () => {
    const { listEfficiencyEvents } = await import("@/lib/efficiency-telemetry");
    const res = await telemetryRoute.POST(
      postRequest("http://localhost/api/model-routing/telemetry", {
        taskType: "engineering",
        taskId: "task-token-ledger",
        agentId: "codex",
        provider: "openai",
        model: "gpt-5.4-mini",
        inputTokens: 1000,
        outputTokens: 250,
        rawContextTokens: 300,
        cachedTokens: 50,
        success: true,
      }) as any
    );

    expect(res.status).toBe(200);
    const rows = listEfficiencyEvents(testDb, {
      eventType: "token_ledger",
      taskId: "task-token-ledger",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentId: "codex",
      eventType: "token_ledger",
      payload: {
        rawContextTokens: 300,
        cachedTokens: 50,
        totalTokens: 1300,
        modelId: "openai/gpt-5.4-mini",
      },
    });
  });

  it("records an explicit zero-token ledger without dividing by zero", async () => {
    const { listEfficiencyEvents } = await import("@/lib/efficiency-telemetry");
    const res = await telemetryRoute.POST(
      postRequest("http://localhost/api/model-routing/telemetry", {
        taskType: "engineering",
        taskId: "task-zero-token-ledger",
        agentId: "codex",
        provider: "local",
        model: "qwen-coder-local",
        inputTokens: 0,
        outputTokens: 0,
        rawContextTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        success: true,
      }) as any
    );

    expect(res.status).toBe(200);
    const rows = listEfficiencyEvents(testDb, {
      eventType: "token_ledger",
      taskId: "task-zero-token-ledger",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({
      rawContextTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      modelId: "local/qwen-coder-local",
    });
  });

  it("uses observed telemetry in recommendations and exposes eval summaries", async () => {
    const { listEfficiencyEvents } = await import("@/lib/efficiency-telemetry");
    await telemetryRoute.POST(
      postRequest("http://localhost/api/model-routing/telemetry", {
        taskType: "product",
        agentId: "pm-agent",
        provider: "openai",
        model: "gpt-5.4-mini",
        strategy: "balanced",
        latencyMs: 1200,
        success: true,
        qualityScore: 0.95,
      }) as any
    );

    const recRes = await recommendationsRoute.GET(
      new Request("http://localhost/api/model-routing/recommendations?taskType=product&strategy=quality") as any
    );
    const recData = await recRes.json();
    expect(recData.recommendations[0].model).toBe("gpt-5.4-mini");
    expect(recData.recommendations[0].observations).toBeGreaterThan(0);

    const evalRes = await evalsRoute.GET();
    const evalData = await evalRes.json();
    expect(evalData.dimensions.map((d: any) => d.id)).toContain("task_fit");
    expect(evalData.summary.totalRuns).toBeGreaterThan(0);
    expect(listEfficiencyEvents(testDb, { eventType: "token_ledger" })).toHaveLength(0);
  });

  it("returns POST recommendations with custom task type, strategy, and limit", async () => {
    const res = await recommendationsRoute.POST(
      postRequest("http://localhost/api/model-routing/recommendations", {
        taskType: "Product",
        strategy: "latency",
        limit: 2,
      }) as any
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskType).toBe("product");
    expect(data.strategy).toBe("latency");
    expect(data.recommendations).toHaveLength(2);
    expect(data.timestamp).toBeTruthy();
  });

  it("defaults POST recommendations when body fields are missing or invalid", async () => {
    const res = await recommendationsRoute.POST(
      postRequest("http://localhost/api/model-routing/recommendations", {
        strategy: "unsupported",
        limit: 99,
      }) as any
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskType).toBe("engineering");
    expect(data.strategy).toBe("balanced");
    expect(data.recommendations.length).toBeLessThanOrEqual(8);
    expect(data.recommendations.length).toBeGreaterThanOrEqual(1);
  });

  it("GET recommendations honor strategy and limit query params", async () => {
    const res = await recommendationsRoute.GET(
      new Request(
        "http://localhost/api/model-routing/recommendations?taskType=engineering&strategy=cost&limit=1"
      ) as any
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskType).toBe("engineering");
    expect(data.strategy).toBe("cost");
    expect(data.recommendations).toHaveLength(1);
  });

  it("GET recommendations clamp invalid limit values", async () => {
    const res = await recommendationsRoute.GET(
      new Request("http://localhost/api/model-routing/recommendations?limit=not-a-number") as any
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(data.recommendations.length).toBeLessThanOrEqual(4);
  });
});
