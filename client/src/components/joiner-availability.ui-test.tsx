// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JoinerAvailability } from "./joiner-availability";
import { decodeAvailability, emptyWeeklyAvailability, encodeAvailability } from "@shared/joiner-availability";

afterEach(cleanup);

const timetable = () => within(screen.getByRole("region", { name: "Weekly availability timetable" }));
const daily = () => within(screen.getByRole("region", { name: "Daily availability" }));

function Controlled({ initial = "", onChange = vi.fn() }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <JoinerAvailability value={value} onChange={next => { setValue(next); onChange(next); }} employmentType="driver" />;
}

describe("joiner availability controls", () => {
  it("starts with 77 labelled unselected toggles and requires an explicit type", () => {
    render(<JoinerAvailability onChange={vi.fn()} onUseRecommended={vi.fn()} />);
    expect(timetable().getAllByRole("button", { pressed: false })).toHaveLength(77);
    expect(timetable().getAllByRole("columnheader")).toHaveLength(8);
    expect(timetable().getByRole("columnheader", { name: /Sun/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use recommended hours" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Select Driver or Walker/)).toBeTruthy();
  });

  it("preserves legacy notes while toggling and clearing full days", () => {
    const onChange = vi.fn();
    render(<Controlled initial="School runs on Tuesday" onChange={onChange} />);
    fireEvent.click(timetable().getByRole("button", { name: "Select all Monday slots" }));
    let saved = decodeAvailability(onChange.mock.lastCall![0]);
    expect(saved.slots[0].every(Boolean)).toBe(true);
    expect(saved.notes).toBe("School runs on Tuesday");
    expect(screen.getByText("7.5 hours")).toBeTruthy();
    fireEvent.click(timetable().getByRole("button", { name: "Clear all Monday slots" }));
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
    const slot = timetable().getByRole("button", { name: "Monday 08:00–09:00" });
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
    expect(timetable().queryAllByRole("button")).toHaveLength(0);
    expect(daily().getAllByRole("button")).toHaveLength(7);
  });

  it("uses one compact selectable day and preserves controlled slots when switching days", () => {
    const onChange = vi.fn();
    render(<Controlled initial="School runs" onChange={onChange} />);
    expect(daily().getAllByRole("button", { pressed: false })).toHaveLength(17);
    expect(daily().getByRole("group", { name: "Monday availability" })).toBeTruthy();
    fireEvent.click(daily().getByRole("button", { name: "Show Sunday" }));
    expect(daily().queryByRole("group", { name: "Monday availability" })).toBeNull();
    expect(daily().getByRole("button", { name: "Show Sunday" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(daily().getByRole("button", { name: "Sunday 20:30–21:30" }));
    const saved = decodeAvailability(onChange.mock.lastCall![0]);
    expect(saved.slots[6][10]).toBe(true);
    expect(saved.notes).toBe("School runs");
    expect(timetable().getByRole("button", { name: "Sunday 20:30–21:30" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(daily().getByRole("button", { name: "Show Monday" }));
    fireEvent.click(daily().getByRole("button", { name: "Show Sunday" }));
    expect(daily().getByRole("button", { name: "Sunday 20:30–21:30" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("allows read-only day navigation without offering slot mutations", () => {
    const data = emptyWeeklyAvailability("Evenings preferred");
    data.slots[6][10] = true;
    render(<JoinerAvailability value={encodeAvailability(data)} employmentType="walker" />);
    fireEvent.click(daily().getByRole("button", { name: "Show Sunday" }));
    expect(daily().getByLabelText("Sunday 20:30–21:30: Available")).toBeTruthy();
    expect(daily().queryByRole("button", { name: "Sunday 20:30–21:30" })).toBeNull();
    expect(daily().queryByRole("button", { name: "Clear all Sunday slots" })).toBeNull();
  });

  it("keeps a single week by default and edits Week 2 separately when alternating is on", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: /Alternating weeks/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(timetable().getByRole("button", { name: "Select all Monday slots" }));
    fireEvent.click(toggle);
    let saved = decodeAvailability(onChange.mock.lastCall![0]);
    expect(saved.alternateSlots?.flat().some(Boolean)).toBe(false);
    expect(screen.getByRole("button", { name: /Week 2/, pressed: true })).toBeTruthy();
    fireEvent.click(timetable().getByRole("button", { name: "Tuesday 08:00–09:00" }));
    saved = decodeAvailability(onChange.mock.lastCall![0]);
    expect(saved.slots[0].every(Boolean)).toBe(true);
    expect(saved.slots[1][0]).toBe(false);
    expect(saved.alternateSlots![1][0]).toBe(true);
    expect(screen.getByText(/lower week · used for contract/).closest("div")?.textContent).toContain("Week 2");
    expect(screen.getByTestId("minimum-status").textContent).toMatch(/Below the 4-hour minimum in Week 2/);
    fireEvent.click(screen.getByRole("switch", { name: /Alternating weeks/ }));
    saved = decodeAvailability(onChange.mock.lastCall![0]);
    expect(saved.alternateSlots).toBeUndefined();
    expect(saved.slots[0].every(Boolean)).toBe(true);
  });

  it("colours the minimum status red below 4 hours and green at or above it", () => {
    const below = emptyWeeklyAvailability();
    below.slots[0][0] = true;
    const { rerender } = render(<JoinerAvailability value={encodeAvailability(below)} employmentType="driver" />);
    expect(screen.getByTestId("minimum-status").className).toContain("text-red-700");
    const above = emptyWeeklyAvailability();
    above.slots[0].fill(true);
    rerender(<JoinerAvailability value={encodeAvailability(above)} employmentType="driver" />);
    expect(screen.getByTestId("minimum-status").className).toContain("text-emerald-800");
    expect(screen.getByTestId("minimum-status").textContent).toContain("Meets the 4-hour minimum");
  });

  it("keeps the formula explanation in a disclosure", () => {
    const { container } = render(<JoinerAvailability employmentType="driver" />);
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(container.querySelector("summary")?.textContent).toBe("How hours are calculated");
  });
});
