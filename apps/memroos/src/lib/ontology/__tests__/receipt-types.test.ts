// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildOntologyTypeReceiptRef,
  ontologyTypeFromCanonicalId,
  withOntologyTypeRef,
} from "../receipt-types";
import { filterOutboundClaims, type Claim } from "@/lib/belief/outbound-policy";
import { buildReceipt } from "@/lib/policy/engine";

describe("ONTO-06 ontology type receipt refs", () => {
  it("builds a gold Claim about Account receipt coordinate", () => {
    const ref = buildOntologyTypeReceiptRef({
      ontologyType: "Claim",
      aboutType: "Account",
      beliefStage: "gold_operational_truth",
    });
    expect(ref).toEqual({
      ontologyType: "claim",
      aboutType: "organization",
      beliefStage: "gold_operational_truth",
      canonicalId: "claim",
    });
    expect(ontologyTypeFromCanonicalId("memroos.claim")).toBe("claim");
  });

  it("enriches policy receipts with ontologyType + aboutType", () => {
    const receipt = buildReceipt(
      {
        domain: "knowledge",
        action: "read",
        actor: { id: "operator", role: "operator", tenantId: "default-tenant" },
        ontologyContext: {
          ontologyId: "memroos.core",
          ontologyVersion: "1.0.0",
          ontologyContentHash: `sha256:${"c".repeat(64)}`,
          namespace: "",
          canonicalId: "claim",
          aliasMigrationPath: [],
        },
        ontologyReference: {
          tenantId: "default-tenant",
          spaceId: "space-a",
          recordType: "memory",
          recordId: "m1",
          aboutType: "Account",
          beliefStage: "gold_operational_truth",
        },
      },
      { outcome: "allow", reason: "safe", ruleMatched: "test" },
    );
    expect(receipt.ontology).toMatchObject({
      ontologyType: "claim",
      aboutType: "organization",
      beliefStage: "gold_operational_truth",
      canonicalId: "claim",
    });
  });

  it("copies ontology type refs onto belief outbound receipts", () => {
    const claim: Claim = {
      stage: "gold_operational_truth",
      content: "Acme ARR is $2M",
      ontologyType: "claim",
      aboutType: "organization",
    };
    const result = filterOutboundClaims([claim], {
      goldOnly: true,
      silverCaveat: "[unverified]",
      bronzeAsCitationOnly: true,
    });
    expect(result.receipts[0]).toMatchObject({
      stage: "gold_operational_truth",
      action: "emitted",
      ontologyType: "claim",
      aboutType: "organization",
    });
    expect(JSON.stringify(result.receipts[0])).not.toContain("Acme ARR");
  });

  it("rejects empty ontologyType tokens", () => {
    expect(() => buildOntologyTypeReceiptRef({ ontologyType: "" })).toThrow(/ontologyType/i);
    expect(ontologyTypeFromCanonicalId("   ")).toBe("");
  });

  it("withOntologyTypeRef preserves prior ontology coordinates", () => {
    const enriched = withOntologyTypeRef(
      {
        ontologyId: "memroos.core",
        ontologyVersion: "1.0.0",
        ontologyContentHash: `sha256:${"d".repeat(64)}`,
        namespace: "",
        canonicalId: "claim",
        aliasMigrationPath: [],
        sourceId: "src",
        sourceHash: `sha256:${"e".repeat(64)}`,
      },
      { aboutType: "Account", beliefStage: "gold_operational_truth" },
    );
    expect(enriched).toMatchObject({
      ontologyId: "memroos.core",
      canonicalId: "claim",
      ontologyType: "claim",
      aboutType: "organization",
      beliefStage: "gold_operational_truth",
      sourceId: "src",
    });
  });
});
