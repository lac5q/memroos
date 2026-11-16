// @vitest-environment node
import { describe, it } from "vitest";

describe("skillforge intake batch39", () => {
  /**
   * redactEntries (166–167) needs restricted securityLabels on intake entries,
   * but collectTelemetry only emits indexable labels — no public hook without
   * changing production intake.ts.
   */
  it.skip("redactEntries restricted branch (166–167) — collectTelemetry never emits requires_redaction/sealed", () => {});
});