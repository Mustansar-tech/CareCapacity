import { z } from "zod";

export const AVAILABILITY_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const AVAILABILITY_SLOTS = [
  "08:00–09:00", "09:15–10:15", "10:30–11:30", "11:45–12:45",
  "13:00–14:00", "14:15–15:15", "15:30–16:30", "16:45–17:45",
  "18:00–19:00", "19:15–20:15", "20:30–21:30",
] as const;

export const MINIMUM_GH_HOURS = 4;

const KIND = "joiner-weekly-availability";
const slotGridSchema = z.array(z.array(z.boolean()).length(11)).length(7);
export const weeklyAvailabilitySchema = z.object({
  kind: z.literal(KIND),
  version: z.literal(1),
  slots: slotGridSchema,
  // Present only when the joiner gives different availability on alternate
  // weeks (Week 1 = slots, Week 2 = alternateSlots). Absent = same every week.
  alternateSlots: slotGridSchema.optional(),
  notes: z.string(),
});
export type WeeklyAvailability = z.infer<typeof weeklyAvailabilitySchema>;

export function emptySlotGrid(): boolean[][] {
  return AVAILABILITY_DAYS.map(() => AVAILABILITY_SLOTS.map(() => false));
}

export function emptyWeeklyAvailability(notes = ""): WeeklyAvailability {
  return { kind: KIND, version: 1, slots: emptySlotGrid(), notes };
}

// The existing text column holds a versioned envelope for new records. Old
// free-text availability remains readable and is preserved as notes on edit.
export function decodeAvailability(value?: string | null): WeeklyAvailability {
  if (!value) return emptyWeeklyAvailability();
  try {
    const parsed = weeklyAvailabilitySchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch { /* Legacy plain text. */ }
  return emptyWeeklyAvailability(value);
}

export function encodeAvailability(value: WeeklyAvailability): string {
  return JSON.stringify(weeklyAvailabilitySchema.parse(value));
}

export const storedAvailabilitySchema = z.string().superRefine((value, ctx) => {
  let decoded: unknown;
  try { decoded = JSON.parse(value); } catch { return; }
  if (decoded && typeof decoded === "object" && "kind" in decoded && decoded.kind === KIND) {
    if (!weeklyAvailabilitySchema.safeParse(decoded).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid weekly availability: select 11 slots for each of 7 days." });
    }
  }
});

export function calculateContractOffer(slots: boolean[][], type: "driver" | "walker") {
  const checked = slotGridSchema.parse(slots);
  const percent = type === "driver" ? 75 : 40;
  const selectedPerDay = checked.map(day => day.filter(Boolean).length);
  const adjustedPerDay = selectedPerDay.map(count => count === 11 ? count - 1 : count);
  const dailyHours = adjustedPerDay.map(count => count * percent / 100);
  const selectedHours = selectedPerDay.reduce((sum, count) => sum + count, 0);
  // Sum integer slot units before applying the percentage to avoid float drift.
  const calculatedHours = adjustedPerDay.reduce((sum, count) => sum + count, 0) * percent / 100;
  return {
    dailyHours,
    selectedHours,
    calculatedHours,
    recommendedHours: calculatedHours >= MINIMUM_GH_HOURS ? calculatedHours : 0,
  };
}

/**
 * Offer for the whole availability record. With alternating weeks the
 * contract is based on the week with LESS availability, so the guaranteed
 * hours can be honoured in both weeks.
 */
export function calculateAvailabilityOffer(availability: WeeklyAvailability, type: "driver" | "walker") {
  const weeks = [availability.slots, ...(availability.alternateSlots ? [availability.alternateSlots] : [])]
    .map(slots => calculateContractOffer(slots, type));
  const basisWeek = weeks.reduce((lowest, week, index) =>
    week.calculatedHours < weeks[lowest].calculatedHours ? index : lowest, 0);
  const basis = weeks[basisWeek];
  return {
    weeks,
    alternating: weeks.length === 2,
    basisWeek,
    calculatedHours: basis.calculatedHours,
    recommendedHours: basis.recommendedHours,
    meetsMinimum: basis.calculatedHours >= MINIMUM_GH_HOURS,
  };
}

export function availabilitySummary(value?: string | null): string {
  const data = decodeAvailability(value);
  const describe = (grid: boolean[][]) => grid.flatMap((slots, index) => {
    const selected = slots.flatMap((enabled, i) => enabled ? [AVAILABILITY_SLOTS[i]] : []);
    return selected.length ? [`${AVAILABILITY_DAYS[index]}: ${selected.join(", ")}`] : [];
  });
  const days = data.alternateSlots
    ? ["Week 1:", ...describe(data.slots), "Week 2:", ...describe(data.alternateSlots)]
    : describe(data.slots);
  return [...days, data.notes].filter(Boolean).join("\n");
}
