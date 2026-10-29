import { describe, expect, it } from "vitest";
import {
  availabilitySummary, calculateAvailabilityOffer, calculateContractOffer, decodeAvailability,
  emptyWeeklyAvailability, encodeAvailability, storedAvailabilitySchema,
} from "./joiner-availability";
import { insertJoinerSchema } from "./schema";

function withCounts(counts: number[]) {
  const data = emptyWeeklyAvailability();
  counts.forEach((count, day) => {
    data.slots[day] = data.slots[day].map((_, index) => index < count);
  });
  return data;
}

describe("joiner availability and offer rules", () => {
  it("starts completely unticked with independent day arrays", () => {
    const data = emptyWeeklyAvailability();
    expect(data.slots.flat().filter(Boolean)).toHaveLength(0);
    data.slots[0][0] = true;
    expect(data.slots[1][0]).toBe(false);
    expect(emptyWeeklyAvailability().slots[0][0]).toBe(false);
  });

  it("matches the driver workbook example exactly", () => {
    const result = calculateContractOffer(withCounts([11, 11, 11, 0, 11, 0, 5]).slots, "driver");
    expect(result).toEqual({
      dailyHours: [7.5, 7.5, 7.5, 0, 7.5, 0, 3.75],
      selectedHours: 49, calculatedHours: 33.75, recommendedHours: 33.75,
    });
  });

  it("matches the walker example exactly", () => {
    expect(calculateContractOffer(withCounts([11, 11]).slots, "walker").recommendedHours).toBe(8);
  });

  it.each(["driver", "walker"] as const)("deducts one slot only for full days (%s)", type => {
    const ten = calculateContractOffer(withCounts([10]).slots, type);
    const eleven = calculateContractOffer(withCounts([11]).slots, type);
    expect(ten.calculatedHours).toBe(eleven.calculatedHours);
    expect(ten.selectedHours).toBe(10);
    expect(eleven.selectedHours).toBe(11);
  });

  it("uses a 4-hour minimum for both types without rounding up", () => {
    expect(calculateContractOffer(withCounts([5]).slots, "driver").recommendedHours).toBe(0);
    expect(calculateContractOffer(withCounts([6]).slots, "driver").recommendedHours).toBe(4.5);
    expect(calculateContractOffer(withCounts([9]).slots, "walker").recommendedHours).toBe(0);
    expect(calculateContractOffer(withCounts([10]).slots, "walker").recommendedHours).toBe(4);
    expect(calculateContractOffer(withCounts([3, 4, 4]).slots, "walker").recommendedHours).toBe(4.4);
  });

  it("recalculates on type changes without changing the selected slots", () => {
    const data = withCounts([11, 11]);
    const before = JSON.stringify(data);
    expect(calculateContractOffer(data.slots, "driver").recommendedHours).toBe(15);
    expect(calculateContractOffer(data.slots, "walker").recommendedHours).toBe(8);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("preserves free-text legacy availability, including JSON-like notes", () => {
    for (const notes of ["Weekday evenings", '{"other":"note"}', "{unfinished"]) {
      expect(decodeAvailability(notes)).toEqual(emptyWeeklyAvailability(notes));
      expect(availabilitySummary(notes)).toBe(notes);
      expect(storedAvailabilitySchema.safeParse(notes).success).toBe(true);
    }
  });

  it("round-trips slots and notes independently of contracted hours", () => {
    const availability = withCounts([11, 0, 5]);
    availability.notes = "Alternate weekends by agreement";
    const encoded = encodeAvailability(availability);
    expect(decodeAvailability(encoded)).toEqual(availability);
    const body = {
      branchId: "example-branch", candidateName: "Example Candidate",
      employmentType: "walker", desiredWeeklyHours: 20, contractedHours: 0,
      availability: encoded,
    };
    const saved = insertJoinerSchema.parse(body);
    expect(saved.contractedHours).toBe(0);
    expect(saved.desiredWeeklyHours).toBe(20);
    expect(decodeAvailability(saved.availability)).toEqual(availability);
    expect(availabilitySummary(saved.availability)).toContain("Monday: 08:00–09:00");
    expect(availabilitySummary(saved.availability)).toContain(availability.notes);
    expect(availabilitySummary(saved.availability)).not.toContain('"kind"');
  });

  it("validates malformed grids on create and partial update", () => {
    const invalid = JSON.stringify({ ...emptyWeeklyAvailability(), slots: [[true]] });
    expect(storedAvailabilitySchema.safeParse(invalid).success).toBe(false);
    expect(insertJoinerSchema.partial().safeParse({ availability: invalid }).success).toBe(false);
    expect(() => calculateContractOffer([[true]], "driver")).toThrow();
    const wrongVersion = JSON.stringify({ ...emptyWeeklyAvailability(), version: 2 });
    expect(storedAvailabilitySchema.safeParse(wrongVersion).success).toBe(false);
  });

  it("recommends alternating-week contracts from the week with less availability", () => {
    const data = withCounts([11, 11]);
    data.alternateSlots = withCounts([6]).slots;
    const offer = calculateAvailabilityOffer(data, "driver");
    expect(offer.alternating).toBe(true);
    expect(offer.weeks.map(w => w.calculatedHours)).toEqual([15, 4.5]);
    expect(offer.basisWeek).toBe(1);
    expect(offer.recommendedHours).toBe(4.5);
    expect(offer.meetsMinimum).toBe(true);
    data.alternateSlots = withCounts([5]).slots;
    expect(calculateAvailabilityOffer(data, "driver")).toMatchObject({ recommendedHours: 0, meetsMinimum: false, basisWeek: 1 });
  });

  it("keeps single-week offers unchanged and round-trips the alternate week", () => {
    const single = withCounts([11, 11]);
    expect(calculateAvailabilityOffer(single, "walker")).toMatchObject({ alternating: false, basisWeek: 0, recommendedHours: 8 });
    const data = withCounts([2]);
    data.alternateSlots = withCounts([0, 3]).slots;
    const encoded = encodeAvailability(data);
    expect(decodeAvailability(encoded)).toEqual(data);
    expect(storedAvailabilitySchema.safeParse(encoded).success).toBe(true);
    expect(availabilitySummary(encoded)).toContain("Week 2:\nTuesday: 08:00–09:00");
    const malformed = JSON.stringify({ ...data, alternateSlots: [[true]] });
    expect(storedAvailabilitySchema.safeParse(malformed).success).toBe(false);
  });

  it("allows missing and legacy availability on existing records", () => {
    expect(insertJoinerSchema.partial().safeParse({ availability: null }).success).toBe(true);
    expect(insertJoinerSchema.partial().safeParse({ notes: "Updated note" }).success).toBe(true);
    expect(availabilitySummary(null)).toBe("");
    expect(calculateContractOffer(emptyWeeklyAvailability().slots, "driver").recommendedHours).toBe(0);
  });
});
