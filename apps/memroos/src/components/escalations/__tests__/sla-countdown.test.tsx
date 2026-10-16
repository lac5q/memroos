import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlaCountdown } from "../sla-countdown";

describe("SlaCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a remaining-time string", () => {
    const deadline = new Date(Date.now() + 3600 * 1000).toISOString();
    render(<SlaCountdown deadline={deadline} slaSeconds={3600} status="open" />);
    // Should display hours/minutes remaining
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("updates the displayed value when 1 second passes (timer ticks)", async () => {
    const deadline = new Date(Date.now() + 125 * 1000).toISOString(); // 2m 5s
    render(<SlaCountdown deadline={deadline} slaSeconds={300} status="open" />);
    const before = screen.getByRole("timer").textContent;

    await act(async () => {
      vi.advanceTimersByTime(60000); // advance 60s
    });

    const after = screen.getByRole("timer").textContent;
    expect(after).not.toBe(before);
  });

  it("shows Overdue when the deadline has passed", () => {
    const deadline = new Date(Date.now() - 1000).toISOString();
    render(<SlaCountdown deadline={deadline} slaSeconds={3600} status="open" />);
    expect(screen.getByRole("timer")).toHaveTextContent("Overdue");
  });

  it("shows seconds-only countdown when under one minute remains", () => {
    const deadline = new Date(Date.now() + 15 * 1000).toISOString();
    render(<SlaCountdown deadline={deadline} slaSeconds={60} status="open" />);
    expect(screen.getByRole("timer").textContent).toMatch(/s$/);
  });

  it("applies a traffic-light color class derived from slaTrafficLight", () => {
    // Plenty of time — should get green color indicator
    const deadline = new Date(Date.now() + 3600 * 1000).toISOString();
    render(<SlaCountdown deadline={deadline} slaSeconds={3600} status="open" />);
    const el = screen.getByRole("timer");
    // data-sla-light attribute should be set
    expect(el.getAttribute("data-sla-light")).toBe("green");
  });
});
