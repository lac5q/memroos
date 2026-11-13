// apps/memroos/src/lib/tool-auth/__tests__/providers.test.ts
// Phase 179 / v8.23 — provider registry unit tests.

import { describe, expect, it } from "vitest";

import {
  CATEGORIES,
  PROVIDERS_BY_KEY,
  PROVIDER_CATEGORIES,
  getCategories,
  getGroupedProviders,
  getProvider,
  getProvidersByCategory,
  isApiKeyProvider,
  isOAuthProvider,
} from "../providers";

describe("tool-auth/providers", () => {
  it("exports 5 ordered categories", () => {
    expect(PROVIDER_CATEGORIES).toEqual([
      "productivity",
      "developer",
      "crm",
      "finance",
      "other",
    ]);
  });

  it("every category has a label and description", () => {
    for (const id of PROVIDER_CATEGORIES) {
      const meta = CATEGORIES[id];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  it("registers only Nango-backed providers", () => {
    // Changed 2026-07-27: the six api-key cards (supabase, aws, intercom,
    // stripe, plaid, generic-rest) were removed. Each rendered a Connect
    // button with no Nango integration behind it — an aspirational list shown
    // as working functionality. crm/finance/other are now legitimately empty.
    expect(Object.keys(PROVIDERS_BY_KEY).length).toBeGreaterThanOrEqual(5);
    const grouped = getGroupedProviders();
    expect(grouped.length).toBe(5);
    for (const key of ["stripe", "plaid", "intercom", "supabase", "aws", "generic-rest"]) {
      expect(PROVIDERS_BY_KEY[key]).toBeUndefined();
    }
    // Every remaining provider is OAuth and Nango-backed.
    for (const p of Object.values(PROVIDERS_BY_KEY)) {
      expect(isOAuthProvider(p)).toBe(true);
    }
  });

  it("every provider has a unique lowercase-hyphen-safe key", () => {
    const keys = Object.keys(PROVIDERS_BY_KEY);
    const seen = new Set<string>();
    for (const k of keys) {
      expect(k).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("every OAuth provider has at least one scope", () => {
    for (const p of Object.values(PROVIDERS_BY_KEY)) {
      if (isOAuthProvider(p)) {
        expect(p.scopes.length).toBeGreaterThan(0);
        expect(p.providerConfigKey.length).toBeGreaterThan(0);
      }
    }
  });

  it("every API-key provider has a docsUrl and field label", () => {
    for (const p of Object.values(PROVIDERS_BY_KEY)) {
      if (isApiKeyProvider(p)) {
        expect(p.apiKeyField.length).toBeGreaterThan(0);
        expect(p.docsUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it("getProvider returns undefined for unknown keys", () => {
    expect(getProvider("not-a-real-provider")).toBeUndefined();
  });

  it("type guards narrow correctly", () => {
    const slack = getProvider("slack");
    expect(slack).toBeDefined();
    if (slack && isOAuthProvider(slack)) {
      // @ts-expect-error — authMode is narrowed to "oauth" here
      expect(slack.apiKeyField).toBeUndefined();
    }
    // No api-key providers remain — the type guard still narrows, there is
    // simply nothing to narrow to.
    expect(Object.values(PROVIDERS_BY_KEY).some(isApiKeyProvider)).toBe(false);
  });

  it("only marks a provider unavailable when it genuinely cannot connect", () => {
    // Calendar now points at the plain `google-calendar` template, which uses
    // Nango's shared developer app like Drive and Gmail — so it carries no
    // hardcoded blocker. Availability is resolved live against Nango instead.
    const gcal = getProvider("google-calendar");
    expect(gcal).toBeDefined();
    if (gcal && isOAuthProvider(gcal)) {
      expect(gcal.providerConfigKey).toBe("google-calendar");
      expect(gcal.unavailableReason).toBeUndefined();
    }
    // Providers with dynamic client registration need no app and stay live.
    const linear = getProvider("linear");
    if (linear && isOAuthProvider(linear)) {
      expect(linear.unavailableReason).toBeUndefined();
    }
    // The mechanism itself must still work: any provider that declares a
    // reason is surfaced as unavailable rather than silently offering a
    // button that dead-ends on an upstream error.
    for (const p of Object.values(PROVIDERS_BY_KEY)) {
      if (isOAuthProvider(p) && p.unavailableReason !== undefined) {
        expect(typeof p.unavailableReason).toBe("string");
        expect(p.unavailableReason.length).toBeGreaterThan(0);
      }
    }
  });

  it("getProvidersByCategory returns arrays for every category id", () => {
    for (const category of PROVIDER_CATEGORIES) {
      const providers = getProvidersByCategory(category);
      expect(Array.isArray(providers)).toBe(true);
    }
    expect(getGroupedProviders().every((group) => group.providers.length >= 0)).toBe(true);
  });

  it("getCategories returns ordered category metadata", () => {
    const cats = getCategories();
    expect(cats.map((c) => c.id)).toEqual([...PROVIDER_CATEGORIES]);
  });

  /**
   * Every OAuth card drives a Connect button that hands its providerConfigKey
   * straight to Nango. A key with no matching Nango integration renders a card
   * that can only fail — which is exactly how Linear shipped (pointing at
   * `linear` when prod only had an admin-gated OAuth app plus `linear-mcp`),
   * and how Slack and Google Calendar were pointing at names without the `-mcp`
   * suffix prod actually uses.
   *
   * This list mirrors the live Nango prod integration list (verified against
   * GET https://api.nango.dev/integrations on 2026-07-27). When you add an
   * integration in the Nango dashboard, add it here in the same commit — a
   * card whose key is absent here is a card no user can connect.
   */
  const NANGO_PROD_INTEGRATIONS = [
    "circleback-mcp",
    "github",
    "google",
    "google-calendar",
    "google-calendar-mcp",
    "google-drive",
    "google-mail",
    "linear-mcp",
    "mcp-generic",
    "notion",
    "slack-mcp",
  ];

  it("every OAuth provider's providerConfigKey exists in Nango prod", () => {
    const orphans = Object.values(PROVIDERS_BY_KEY)
      .filter(isOAuthProvider)
      .filter((p) => !NANGO_PROD_INTEGRATIONS.includes(p.providerConfigKey))
      .map((p) => `${p.key} -> ${p.providerConfigKey}`);

    expect(orphans).toEqual([]);
  });
});