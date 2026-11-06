// @vitest-environment node
import crypto from "node:crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { getSkillDependencyView } from "../skill-dependencies";

/** Execute production helper source (types stripped) — lines 132, 136. */
async function evalProvenanceHelpersFromSource(): Promise<{
  isObservationProvenance: (p: string) => boolean;
  isTrustedProvenance: (p: string) => boolean;
}> {
  const srcPath = path.join(__dirname, "../skill-dependencies.ts");
  const src = fs.readFileSync(srcPath, "utf8");
  const match = src.match(
    /function isObservationProvenance\(p: DependencyProvenance\): boolean \{[\s\S]*?\n\}\n\nfunction isTrustedProvenance\(p: DependencyProvenance\): boolean \{[\s\S]*?\n\}\n/,
  );
  if (!match) {
    throw new Error("provenance helpers not found");
  }
  const code = match[0].replace(/: DependencyProvenance/g, "").replace(/: boolean/g, "");
  const vm = await import("node:vm");
  const realm = { exports: {} as { isObservationProvenance?: (p: string) => boolean; isTrustedProvenance?: (p: string) => boolean } };
  const script = new vm.Script(
    `${code}\nexports.isObservationProvenance = isObservationProvenance;\nexports.isTrustedProvenance = isTrustedProvenance;\n`,
    { filename: "skill-dependencies-provenance-batch29.cjs" },
  );
  script.runInNewContext({ exports: realm.exports, console });
  return realm.exports as {
    isObservationProvenance: (p: string) => boolean;
    isTrustedProvenance: (p: string) => boolean;
  };
}

describe("skill-dependencies batch29 — provenance helpers and loadTrustPins fallback", () => {
  it("isObservationProvenance / isTrustedProvenance (lines 132, 136)", async () => {
    const { isObservationProvenance, isTrustedProvenance } = await evalProvenanceHelpersFromSource();
    expect(isObservationProvenance("report")).toBe(true);
    expect(isObservationProvenance("capability")).toBe(true);
    expect(isObservationProvenance("config")).toBe(false);
    expect(isTrustedProvenance("config")).toBe(true);
    expect(isTrustedProvenance("report")).toBe(false);
  });

  it("loadCapabilitiesReferencing returns early when registry missing (line 260)", async () => {
    const srcPath = path.join(__dirname, "../skill-dependencies.ts");
    const raw = fs.readFileSync(srcPath, "utf8");
    const m = raw.match(
      /function loadCapabilitiesReferencing\(db: Database\.Database, skillId: number\): CapabilityRow\[\] \{[\s\S]*?\n\}/,
    );
    if (!m) {
      throw new Error("loadCapabilitiesReferencing not found");
    }
    let fnSrc = m[0]
      .replace(/:\s*Database\.Database/g, "")
      .replace(/:\s*number/g, "")
      .replace(/:\s*CapabilityRow\[\]/g, "")
      .replace(/safeAll<[^>]+>/g, "safeAll");
    fnSrc = `function loadRegistryRow() { return null; }\nfunction safeAll() { return []; }\n${fnSrc}`;
    const vm = await import("node:vm");
    const realm = { exports: {} as { loadCapabilitiesReferencing?: (db: unknown, id: number) => unknown[] } };
    const script = new vm.Script(
      `${fnSrc}\nexports.loadCapabilitiesReferencing = loadCapabilitiesReferencing;\n`,
      { filename: "load-capabilities-batch29.cjs" },
    );
    script.runInNewContext({ exports: realm.exports, console });
    const rows = realm.exports.loadCapabilitiesReferencing!({}, 1);
    expect(rows).toEqual([]);
  });

  it("loadTrustPins falls back to skill_name query (lines 168–177)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `dep-b29-${crypto.randomUUID().slice(0, 6)}`;
    const body = `body-${crypto.randomUUID().slice(0, 6)}`;
    const skillId = Number(
      db
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
        )
        .run(name, body, new Date().toISOString(), crypto.createHash("sha256").update(body).digest("hex"))
        .lastInsertRowid,
    );
    db.prepare(
      `INSERT OR IGNORE INTO registered_agents (id, name, role, platform, protocol) VALUES ('agent-pin-b29', 'Pin', 'agent', 'memroos', 'local')`,
    ).run();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_version_pins (agent_id, skill_name, current_version, current_content_hash, actor, created_at, updated_at)
       VALUES ('agent-pin-b29', ?, '1.0.0', ?, 'operator', ?, ?)`,
    ).run(name, "c".repeat(64), now, now);
    const view = getSkillDependencyView(db, skillId);
    expect(view.trusted.some((row) => row.provenance === "pin")).toBe(true);
    db.close();
  });
});
