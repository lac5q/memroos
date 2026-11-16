// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";
import { updateCronJobStatus, upsertCronHealthJob } from "@/lib/cron-health";
import {
  classifyScalar,
  describeMetricEnvelope,
  metricEnvelope,
  panelStatusToMetricStatus,
  type MetricScope,
  withSourceMeta,
} from "@/lib/metric-status";
import { generateKeyPair, verifySkill } from "@/lib/skills/skill-signing";

const scope: MetricScope = { window: "24h", workspace: "all" };

describe("lib leftovers batch39c", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("metricEnvelope nulls value for stale/degraded/unavailable constructors (metric-status 76-77)", () => {
    for (const status of ["stale", "degraded", "unavailable"] as const) {
      const env = metricEnvelope({
        value: 9,
        status,
        source: `batch39c-${status}`,
        observedAt: "2026-11-16T09:00:00.000Z",
        scope,
      });
      expect(env.value).toBeNull();
      expect(env.status).toBe(status);
      expect(env.reason).toBeTruthy();
    }
  });

  it("describeMetricEnvelope labels stale, blocked, degraded, and unavailable (203-218)", () => {
    expect(describeMetricEnvelope(metricEnvelope({ value: null, status: "stale", source: "x", observedAt: null, scope })).label).toBe(
      "stale",
    );
    expect(describeMetricEnvelope(metricEnvelope({ value: null, status: "blocked", source: "x", observedAt: null, scope })).tone).toBe(
      "warn",
    );
    expect(describeMetricEnvelope(metricEnvelope({ value: null, status: "degraded", source: "x", observedAt: null, scope })).label).toBe(
      "degraded",
    );
    expect(
      describeMetricEnvelope(metricEnvelope({ value: null, status: "unavailable", source: "x", observedAt: null, scope })).label,
    ).toBe("unavailable");
  });

  it("panelStatusToMetricStatus preserves degraded when source is healthy with rows (193)", () => {
    expect(panelStatusToMetricStatus("degraded", { sourceOk: true, rowCount: 3 })).toBe("degraded");
    expect(panelStatusToMetricStatus("missing", { sourceOk: false, rowCount: 0 })).toBe("unavailable");
  });

  it("classifyScalar ignores unparseable latestAt and still classifies live rows (145-157)", () => {
    const result = classifyScalar({
      rowCount: 2,
      sourceOk: true,
      latestAt: "not-a-valid-iso",
      freshnessMs: 500,
      freshnessThresholdMs: 1_000,
      now: Date.UTC(2026, 10, 16, 12, 0, 0),
    });
    expect(result.status).toBe("live");
    expect(result.reason).toContain("2");
  });

  it("withSourceMeta keeps prior observedAt when patch omits it (withSourceMeta 107)", () => {
    const merged = withSourceMeta(
      metricEnvelope({
        value: 4,
        status: "live",
        source: "sqlite://batch39c",
        observedAt: "2026-11-16T08:00:00.000Z",
        scope,
      }),
      { freshnessMs: 42_000 },
    );
    expect(merged.observedAt).toBe("2026-11-16T08:00:00.000Z");
    expect(merged.freshnessMs).toBe(42_000);
  });

  it("updateCronJobStatus returns null when job id is missing (cron-health 196)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(updateCronJobStatus(db, `missing-b39c-${randomUUID().slice(0, 6)}`, "paused")).toBeNull();
    db.close();
  });

  it("upsertCronHealthJob normalizes unknown status values to active (cron-health 106)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const job = upsertCronHealthJob(db, {
      id: `odd-status-b39c-${randomUUID().slice(0, 6)}`,
      name: "Odd status",
      sourceFamily: "test",
      schedule: "manual",
      status: "mystery" as "active",
    });
    expect(job.status).toBe("active");
    db.close();
  });

  it("verifySkill returns false on malformed signature bytes (skill-signing 166)", () => {
    const { publicKey } = generateKeyPair();
    vi.spyOn(crypto, "verify").mockRestore();
    expect(verifySkill(publicKey, hashSkillPlaceholder(), "not-base64!!!")).toBe(false);
  });
});

function hashSkillPlaceholder(): string {
  return crypto.createHash("sha256").update(`batch39c-skill-${randomUUID()}`).digest("hex");
}