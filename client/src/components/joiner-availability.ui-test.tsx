// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinerAvailability } from "./joiner-availability";
import { decodeAvailability, emptyWeeklyAvailability, encodeAvailability } from "@shared/joiner-availability";

afterEach(cleanup);

function Controlled({ initial = "", onChange = vi.fn() }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <JoinerAvailability value={value} onChange={next => { setValue(next); onChange(next); }} employmentType="driver" />;
}

describe("joiner availability controls", () => {
  it("starts with 77 labelled unselected toggles and requires an explicit type", () => {
    render(<JoinerAvailability onChange={vi.fn()} onUseRecommended={vi.fn()} />);
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(77);
    expect(screen.getByRole("button", { name: "Use recommended hours" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Select Driver or Walker/)).toBeTruthy();
  });

  it("preserves legacy notes while toggling and clearing full days", () => {
    const onChange = vi.fn();
    render(<Controlled initial="School runs on Tuesday" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all Monday slots" }));
    let saved = decodeAvailability(onChange.mock.lastCall![0]);
    expect(saved.slots[0].every(Boolean)).toBe(true);
    expect(saved.notes).toBe("School runs on Tuesday");
    expect(screen.getByText("7.5 hours")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear all Monday slots" }));
    saved = decodeAvailability(onChange.mock.lastCall![0]);
    expect(saved.slots[0].some(Boolean)).toBe(false);
    expect(saved.notes).toBe("School runs on Tuesday");
  });

  it("notes editing and clear all never discard each other's data", () => {
    const data = emptyWeeklyAvailability("Original note");
    data.slots[3][7] = true;
    const onChange = vi.fn();
    render(<Controlled initial={encodeAvailability(data)} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Availability notes"), { target: { value: "Updated note" } });
    expect(decodeAvailability(onChange.mock.lastCall![0]).slots[3][7]).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear all slots" }));
    const saved = decodeAvailability(onChange.mock.lastCall![0]);
    expect(saved.notes).toBe("Updated note");
    expect(saved.slots.flat().some(Boolean)).toBe(false);
  });

  it("responds to keyboard activation with a labelled pressed state", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const slot = screen.getByRole("button", { name: "Monday 08:00–09:00" });
    slot.focus();
    await user.keyboard(" ");
    expect(slot.getAttribute("aria-pressed")).toBe("true");
    await user.keyboard("{Enter}");
    expect(slot.getAttribute("aria-pressed")).toBe("false");
  });

  it("recalculates exact fractions when type changes without changing the agreement", () => {
    const data = emptyWeeklyAvailability();
    data.slots[0].fill(true);
    const apply = vi.fn();
    const value = encodeAvailability(data);
    const { rerender } = render(<JoinerAvailability value={value} employmentType="driver" contractedHours={12.25} onUseRecommended={apply} />);
    expect(screen.getByText("7.5 hours")).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    rerender(<JoinerAvailability value={value} employmentType="walker" contractedHours={12.25} onUseRecommended={apply} />);
    expect(screen.getByText("4 hours")).toBeTruthy();
    expect(screen.getByText("12.25 hours / week")).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use recommended hours" }));
    expect(apply).toHaveBeenCalledExactlyOnceWith(4);
  });

  it.each(["driver", "walker"])("explains the four-hour minimum for %s", employmentType => {
    const data = emptyWeeklyAvailability();
    data.slots[0][0] = true;
    render(<JoinerAvailability value={encodeAvailability(data)} employmentType={employmentType} contractedHours={8} />);
    expect(screen.getByText(/Below the 4-hour minimum/)).toBeTruthy();
    expect(screen.getByText("0 hours · Zero-hours / Bank")).toBeTruthy();
    expect(screen.getByText("8 hours / week")).toBeTruthy();
  });

  it("shows actual zero-hours status and invokes zero-hours only on request", () => {
    const zero = vi.fn();
    render(<JoinerAvailability contractedHours={0} onZeroHours={zero} />);
    expect(screen.getByText("Zero-hours / Bank (0 hours)")).toBeTruthy();
    expect(zero).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Agree zero-hours / Bank" }));
    expect(zero).toHaveBeenCalledOnce();
  });

  it("rehydrates changed stored values and never exposes raw JSON", () => {
    const data = emptyWeeklyAvailability("Evenings preferred");
    data.slots[6][10] = true;
    const { rerender, container } = render(<JoinerAvailability value="" />);
    rerender(<JoinerAvailability value={encodeAvailability(data)} employmentType="walker" />);
    expect(screen.getByLabelText("Sunday 20:30–21:30: Available")).toBeTruthy();
    expect(screen.getByText("Evenings preferred")).toBeTruthy();
    expect(container.textContent).not.toContain("joiner-weekly-availability");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
