import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "../top-bar";
import type { HealthStatus } from "@/types";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/storage-health", () => ({
  hasStoragePanic: (services: HealthStatus[]) =>
    services.some((service) => service.detail?.toLowerCase().includes("storage panic")),
  storagePanicAlerts: (services: HealthStatus[]) =>
    services.filter((service) => service.detail?.toLowerCase().includes("storage panic")),
}));

describe("TopBar", () => {
  beforeEach(() => {
    push.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a stable clock placeholder during server rendering", () => {
    const html = renderToString(<TopBar services={[]} />);

    expect(html).toContain('data-topbar-clock="true"');
    expect(html).toContain(">—</span>");
  });

  it("submits global search and opens the mobile menu", () => {
    const onMenuClick = vi.fn();
    render(<TopBar services={[]} onMenuClick={onMenuClick} />);

    fireEvent.click(screen.getByLabelText("Open menu"));
    expect(onMenuClick).toHaveBeenCalled();

    const input = screen.getByLabelText("Search memory, knowledge, agents");
    fireEvent.change(input, { target: { value: "  recall policy  " } });
    fireEvent.submit(input.closest("form")!);
    expect(push).toHaveBeenCalledWith("/notebooks?q=recall%20policy");
  });

  it("labels health for degraded services and storage panic", () => {
    const degraded: HealthStatus[] = [
      { service: "neo4j", status: "down", detail: "offline" },
      { service: "qdrant", status: "up", detail: "ok" },
    ];
    const { rerender } = render(<TopBar services={degraded} />);
    expect(screen.getByText(/1 service degraded/i)).toBeInTheDocument();

    rerender(<TopBar services={[{ service: "sqlite", status: "down", detail: "storage panic on disk" }]} />);
    expect(screen.getByText(/STORAGE PANIC/i)).toBeInTheDocument();
    expect(document.querySelector('[data-storage-panic="true"]')).toBeTruthy();
  });

  it("focuses search on meta/ctrl+k", () => {
    render(<TopBar services={[]} />);
    const input = screen.getByLabelText("Search memory, knowledge, agents");
    const focusSpy = vi.spyOn(input, "focus");
    fireEvent.keyDown(input, { key: "k", metaKey: true });
    expect(focusSpy).toHaveBeenCalled();
  });
});
