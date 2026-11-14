// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Provider } from "@/lib/tool-auth/providers";

const listNangoIntegrationKeys = vi.fn(async () => new Set<string>(["slack-mcp"]));

vi.mock("@/lib/tool-auth/nango-client", () => ({
  listNangoIntegrationKeys: (...args: unknown[]) => listNangoIntegrationKeys(...args),
}));

vi.mock("@/lib/tool-auth/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tool-auth/providers")>();
  const oauthWithReason = {
    key: "blocked-oauth",
    label: "Blocked OAuth",
    description: "Static blocker",
    category: "productivity" as const,
    authMode: "oauth" as const,
    providerConfigKey: "blocked-oauth",
    scopes: ["read"],
    unavailableReason: "OAuth client deleted upstream",
    icon: actual.getProvider("slack")!.icon,
  };
  const fakeApiKey = {
    key: "legacy-api",
    label: "Legacy API",
    description: "Api key stub",
    category: "other" as const,
    authMode: "api-key" as const,
    apiKeyField: "API Key",
    docsUrl: "http://localhost/docs",
    icon: actual.getProvider("slack")!.icon,
  };
  const categories = [
    { id: "productivity" as const, label: "Productivity", description: "Prod" },
    { id: "other" as const, label: "Other", description: "Other" },
  ];
  return {
    ...actual,
    getCategories: () => categories,
    getProvidersByCategory: (id: string) => {
      if (id === "productivity") return [oauthWithReason as Provider];
      if (id === "other") return [fakeApiKey as Provider];
      return [];
    },
    isOAuthProvider: actual.isOAuthProvider,
    isApiKeyProvider: actual.isApiKeyProvider,
  };
});

const { GET } = await import("../route");

describe("GET /api/tools/providers batch33", () => {
  it("returns null unavailableReason for non-oauth providers (L30)", async () => {
    const res = await GET(new Request("http://localhost/api/tools/providers") as never);
    const body = await res.json();
    const other = body.categories.find((c: { id: string }) => c.id === "other");
    expect(other.providers[0].unavailableReason).toBeNull();
  });

  it("prefers static unavailableReason over Nango lookup (L33)", async () => {
    const res = await GET(new Request("http://localhost/api/tools/providers") as never);
    const body = await res.json();
    const prod = body.categories.find((c: { id: string }) => c.id === "productivity");
    expect(prod.providers[0].unavailableReason).toBe("OAuth client deleted upstream");
  });
});
