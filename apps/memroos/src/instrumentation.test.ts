// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startConsolidationScheduler = vi.fn();
const startDecayScheduler = vi.fn();
const startRetentionExpiryScheduler = vi.fn();
const startGraphCatchupScheduler = vi.fn();
const startWikiDigestScheduler = vi.fn();
const prewarmResponseCaches = vi.fn();
const startSlaScheduler = vi.fn();
const startEmbeddingJob = vi.fn();
const startConnectorJob = vi.fn();
const validateMemroosEnvAtStartup = vi.fn();
const assertHostTopology = vi.fn();
const tryAcquireSchedulerLock = vi.fn();

vi.mock("./lib/env", () => ({ validateMemroosEnvAtStartup }));
vi.mock("./lib/host-profile/assert-topology", () => ({ assertHostTopology }));
vi.mock("./lib/scheduler-singleton", () => ({ tryAcquireSchedulerLock }));
vi.mock("./lib/memory-consolidation", () => ({ startConsolidationScheduler }));
vi.mock("./lib/memory-decay", () => ({ startDecayScheduler }));
vi.mock("./lib/memory-retention-expiry-scheduler", () => ({ startRetentionExpiryScheduler }));
vi.mock("./lib/memory-graph-catchup-scheduler", () => ({ startGraphCatchupScheduler }));
vi.mock("./lib/wiki-digest-scheduler", () => ({ startWikiDigestScheduler }));
vi.mock("./lib/response-cache", () => ({ prewarmResponseCaches }));
vi.mock("./lib/hil/sla-scheduler", () => ({ startSlaScheduler }));
vi.mock("./lib/embeddings/embedding-job", () => ({ startEmbeddingJob }));
vi.mock("./lib/connectors/sync-job", () => ({ startConnectorJob }));

describe("instrumentation.register", () => {
  const prevRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_RUNTIME = "nodejs";
    tryAcquireSchedulerLock.mockReturnValue(true);
  });

  afterEach(() => {
    if (prevRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = prevRuntime;
    vi.resetModules();
  });

  it("starts schedulers when the singleton lock is acquired", async () => {
    const { register } = await import("./instrumentation");
    await register();
    expect(validateMemroosEnvAtStartup).toHaveBeenCalled();
    expect(assertHostTopology).toHaveBeenCalled();
    expect(startGraphCatchupScheduler).toHaveBeenCalled();
    expect(startConnectorJob).toHaveBeenCalled();
    expect(prewarmResponseCaches).toHaveBeenCalled();
  });

  it("skips scheduler startup when another process holds the lock", async () => {
    tryAcquireSchedulerLock.mockReturnValue(false);
    const { register } = await import("./instrumentation");
    await register();
    expect(startGraphCatchupScheduler).not.toHaveBeenCalled();
    expect(startConnectorJob).not.toHaveBeenCalled();
  });

  it("no-ops outside the nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("./instrumentation");
    await register();
    expect(validateMemroosEnvAtStartup).not.toHaveBeenCalled();
    expect(startGraphCatchupScheduler).not.toHaveBeenCalled();
  });
});
