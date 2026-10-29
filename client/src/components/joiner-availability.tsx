import { useId, useState } from "react";
import { Ban, CheckCircle2, CircleAlert, Repeat } from "lucide-react";
import "./joiner-availability.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AVAILABILITY_DAYS,
  AVAILABILITY_SLOTS,
  MINIMUM_GH_HOURS,
  calculateAvailabilityOffer,
  decodeAvailability,
  emptySlotGrid,
  encodeAvailability,
  type WeeklyAvailability,
} from "@shared/joiner-availability";

interface JoinerAvailabilityProps {
  value?: string | null;
  onChange?: (value: string) => void;
  employmentType?: string | null;
  contractedHours?: number | string | null;
  onUseRecommended?: (hours: number) => void;
  onZeroHours?: () => void;
}

const WEEK_LABELS = ["Week 1", "Week 2"] as const;
const countSelected = (grid: boolean[][]) => grid.reduce((sum, day) => sum + day.filter(Boolean).length, 0);

/** Controlled by the stored string: notes and slots always share one source of truth. */
export function JoinerAvailability({
  value,
  onChange,
  employmentType,
  contractedHours,
  onUseRecommended,
  onZeroHours,
}: JoinerAvailabilityProps) {
  const id = useId();
  const [activeDay, setActiveDay] = useState(0);
  const [selectedWeek, setSelectedWeek] = useState<0 | 1>(0);
  const availability = decodeAvailability(value);
  const alternating = !!availability.alternateSlots;
  const activeWeek: 0 | 1 = alternating ? selectedWeek : 0;
  const grid = activeWeek === 1 && availability.alternateSlots ? availability.alternateSlots : availability.slots;
  const weekLabel = alternating ? `${WEEK_LABELS[activeWeek]} ` : "";
  const type = employmentType === "driver" || employmentType === "walker" ? employmentType : null;
  const offer = type ? calculateAvailabilityOffer(availability, type) : null;
  const weekOffer = offer?.weeks[activeWeek] ?? null;
  const selectedHours = countSelected(grid);
  const hasAgreement = contractedHours !== undefined && contractedHours !== null && contractedHours !== "";
  const agreedHours = hasAgreement ? Number(contractedHours) : null;
  const agreedBelowMinimum = agreedHours !== null && agreedHours > 0 && agreedHours < MINIMUM_GH_HOURS;

  const update = (next: WeeklyAvailability) => onChange?.(encodeAvailability(next));
  const updateGrid = (next: boolean[][]) => update(activeWeek === 1
    ? { ...availability, alternateSlots: next }
    : { ...availability, slots: next });
  const setDay = (dayIndex: number, enabled: boolean) =>
    updateGrid(grid.map((day, index) => index === dayIndex ? day.map(() => enabled) : day));
  const toggleSlot = (dayIndex: number, slotIndex: number) =>
    updateGrid(grid.map((slots, index) => index === dayIndex
      ? slots.map((enabled, i) => i === slotIndex ? !enabled : enabled) : slots));
  const setAlternating = (enabled: boolean) => {
    if (enabled) {
      update({ ...availability, alternateSlots: emptySlotGrid() });
      setSelectedWeek(1);
    } else {
      const { alternateSlots: _removed, ...rest } = availability;
      update(rest);
      setSelectedWeek(0);
    }
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="joiner-availability min-w-0 space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">Weekly availability</h3>
        {onChange && (
          <Button type="button" variant="ghost" size="sm" disabled={selectedHours === 0}
            onClick={() => updateGrid(grid.map(day => day.map(() => false)))}>
            {alternating ? `Clear ${WEEK_LABELS[activeWeek]} slots` : "Clear all slots"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <p id={`${id}-alt-label`} className="flex items-center gap-1.5 text-sm font-medium">
            <Repeat className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Alternating weeks
          </p>
          <p id={`${id}-alt-help`} className="text-xs text-muted-foreground">
            {alternating
              ? "Week 1 and Week 2 repeat in turn. The contract is recommended from the week with less availability."
              : "Turn on only if the joiner gives a different availability on alternate weeks."}
          </p>
        </div>
        {onChange ? (
          <button type="button" role="switch" aria-checked={alternating}
            aria-labelledby={`${id}-alt-label`} aria-describedby={`${id}-alt-help`}
            onClick={() => setAlternating(!alternating)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              alternating ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-600"}`}>
            <span className={`pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform ${
              alternating ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">{alternating ? "On" : "Off"}</span>
        )}
      </div>

      {alternating && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choose alternating week">
          {WEEK_LABELS.map((label, index) => {
            const weekHours = offer?.weeks[index]?.calculatedHours;
            return (
              <button key={label} type="button" aria-pressed={activeWeek === index}
                onClick={() => setSelectedWeek(index as 0 | 1)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  activeWeek === index ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}>
                {label}
                <span className="ml-1.5 text-xs font-normal opacity-80">
                  {weekHours === undefined ? `${countSelected(index === 1 ? availability.alternateSlots! : availability.slots)} slots` : `${weekHours} h`}
                </span>
              </button>
            );
          })}
          {onChange && <span className="self-center text-xs text-muted-foreground">Editing {WEEK_LABELS[activeWeek]}</span>}
        </div>
      )}

      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        Each selected slot records one available hour. Gaps between slots are not counted.
        {onChange ? " Select individual slots or a whole day." : ""}
      </p>
      <div className="availability-mobile min-w-0 space-y-3" role="region" aria-label="Daily availability">
        <div className="availability-day-tabs" role="group" aria-label="Choose availability day">
          {AVAILABILITY_DAYS.map((day, index) => (
            <button key={day} type="button" aria-pressed={activeDay === index}
              aria-label={`Show ${day}`} aria-controls={`${id}-day`}
              onClick={() => setActiveDay(index)}
              className={`availability-day-tab rounded-md border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                activeDay === index ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/40"}`}>
              {day.slice(0, 3)}
            </button>
          ))}
        </div>
        <div id={`${id}-day`} className="min-w-0 space-y-2" role="group" aria-label={`${weekLabel}${AVAILABILITY_DAYS[activeDay]} availability`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium">{weekLabel}{AVAILABILITY_DAYS[activeDay]}</h4>
            {onChange && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setDay(activeDay, true)}
                  aria-label={`Select all ${AVAILABILITY_DAYS[activeDay]} slots`}>Select day</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setDay(activeDay, false)}
                  aria-label={`Clear all ${AVAILABILITY_DAYS[activeDay]} slots`}>Clear day</Button>
              </div>
            )}
          </div>
          <div className="availability-slot-grid">
            {AVAILABILITY_SLOTS.map((slot, slotIndex) => {
              const selected = grid[activeDay][slotIndex];
              const slotClass = `flex min-h-10 items-center justify-between gap-1 rounded-md border px-2 py-1 text-xs tabular-nums ${
                selected ? "border-emerald-600 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200"
                  : "border-border bg-background text-muted-foreground"}`;
              return onChange ? (
                <button key={slot} type="button" className={`${slotClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                  aria-label={`${AVAILABILITY_DAYS[activeDay]} ${slot}`} aria-pressed={selected}
                  onClick={() => toggleSlot(activeDay, slotIndex)}>
                  <span>{slot}</span><span>{selected ? "Yes" : "—"}</span>
                </button>
              ) : (
                <span key={slot} className={slotClass}
                  aria-label={`${AVAILABILITY_DAYS[activeDay]} ${slot}: ${selected ? "Available" : "Not selected"}`}>
                  <span>{slot}</span><span>{selected ? "Yes" : "—"}</span>
                </span>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Calculated hours: {weekOffer ? weekOffer.dailyHours[activeDay] : "—"}</p>
        </div>
      </div>
      <div className="availability-desktop min-w-0 rounded-md border border-border" role="region"
        aria-label="Weekly availability timetable" aria-describedby={`${id}-help`}>
        <table className="border-collapse text-xs">
          <caption className="sr-only">{weekLabel}available one-hour slots by day</caption>
          <thead>
            <tr className="bg-muted/50">
              <th scope="col" className="p-2 text-left font-medium">{alternating ? `${WEEK_LABELS[activeWeek]} slot` : "One-hour slot"}</th>
              {AVAILABILITY_DAYS.map((day, dayIndex) => (
                <th scope="col" key={day} className="p-1.5 text-center font-medium">
                  <abbr title={day} className="no-underline">{day.slice(0, 3)}</abbr>
                  {onChange && (
                    <div className="mt-1 flex flex-col">
                      <button type="button" aria-label={`Select all ${day} slots`} onClick={() => setDay(dayIndex, true)}
                        className="rounded px-1 py-1 text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Select day</button>
                      <button type="button" aria-label={`Clear all ${day} slots`} onClick={() => setDay(dayIndex, false)}
                        className="rounded px-1 py-1 text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Clear day</button>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AVAILABILITY_SLOTS.map((slot, slotIndex) => (
              <tr key={slot} className="border-t border-border">
                <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-normal tabular-nums">{slot}</th>
                {AVAILABILITY_DAYS.map((day, dayIndex) => {
                  const selected = grid[dayIndex][slotIndex];
                  const className = `flex min-h-6 w-full items-center justify-center rounded border text-xs font-medium ${
                    selected ? "border-emerald-600 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-200"
                      : "border-border bg-background text-muted-foreground"}`;
                  return (
                    <td key={day} className="px-1 py-0.5 text-center">
                      {onChange ? (
                        <button type="button" aria-label={`${day} ${slot}`} aria-pressed={selected}
                          className={`${className} hover:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`}
                          onClick={() => toggleSlot(dayIndex, slotIndex)}>
                          {selected ? "Yes" : "—"}
                        </button>
                      ) : (
                        <span className={className} aria-label={`${day} ${slot}: ${selected ? "Available" : "Not selected"}`}>
                          {selected ? "Yes" : "—"}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/50">
              <th scope="row" className="p-2 text-left font-medium">Calculated hours</th>
              {AVAILABILITY_DAYS.map((day, i) => (
                <td key={day} className="p-2 text-center tabular-nums">{weekOffer ? weekOffer.dailyHours[i] : "—"}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="availability-calculator min-w-0 space-y-2 rounded-md bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-1">
          <span>Raw availability</span>
          <strong className="tabular-nums">
            {alternating
              ? `Week 1: ${countSelected(availability.slots)} · Week 2: ${countSelected(availability.alternateSlots!)} one-hour slots`
              : `${selectedHours} one-hour slots / week`}
          </strong>
        </div>
        {offer ? (
          <>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">How hours are calculated</summary>
              <p className="pt-1">
                {type === "driver" ? "Driver: 75%" : "Walker: 40%"} of selected hours.
                On each day with all 11 slots selected, one hour is deducted before applying the percentage.
                The minimum GH offer is {MINIMUM_GH_HOURS} hours for both drivers and walkers.
                {alternating ? " With alternating weeks, the recommendation uses the week with fewer calculated hours." : ""}
              </p>
            </details>
            {offer.alternating ? offer.weeks.map((week, index) => (
              <div key={WEEK_LABELS[index]} className="flex flex-wrap justify-between gap-1">
                <span>
                  {WEEK_LABELS[index]} calculated hours
                  {offer.basisWeek === index && <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">lower week · used for contract</span>}
                </span>
                <strong className="tabular-nums">{week.calculatedHours} hours</strong>
              </div>
            )) : (
              <div className="flex flex-wrap justify-between gap-1">
                <span>Calculated weekly hours</span><strong className="tabular-nums">{offer.calculatedHours} hours</strong>
              </div>
            )}
            <div role="status" data-testid="minimum-status"
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm font-medium ${offer.meetsMinimum
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"}`}>
              {offer.meetsMinimum
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
              <span>
                {offer.meetsMinimum
                  ? `Meets the ${MINIMUM_GH_HOURS}-hour minimum${offer.alternating ? ` (${WEEK_LABELS[offer.basisWeek]})` : ""}`
                  : `Below the ${MINIMUM_GH_HOURS}-hour minimum${offer.alternating ? ` in ${WEEK_LABELS[offer.basisWeek]}` : ""}: a zero-hours / Bank agreement is recommended.`}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span>Recommended GH contract</span>
              <strong className={`tabular-nums ${offer.meetsMinimum ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
                {offer.recommendedHours === 0 ? "0 hours · Zero-hours / Bank" : `${offer.recommendedHours} hours / week`}
              </strong>
            </div>
          </>
        ) : (
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Select Driver or Walker in Type to calculate a recommendation.</p>
        )}
        <div className="flex flex-wrap justify-between gap-1 border-t border-border pt-2">
          <span>Actual agreed contract</span>
          <strong className={`tabular-nums ${agreedBelowMinimum ? "text-red-700 dark:text-red-300" : agreedHours !== null && agreedHours >= MINIMUM_GH_HOURS ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
            {agreedHours === null ? "Not yet entered" : agreedHours === 0 ? "Zero-hours / Bank (0 hours)" : `${agreedHours} hours / week`}
          </strong>
        </div>
        {agreedBelowMinimum && (
          <p className="text-xs font-medium text-red-700 dark:text-red-300">The agreed contract is below the {MINIMUM_GH_HOURS}-hour minimum.</p>
        )}
        {(onUseRecommended || onZeroHours) && (
          <>
            <div className="flex flex-wrap gap-2 pt-1">
              {onUseRecommended && (
                <Button type="button" size="sm" disabled={!offer}
                  className="bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-600/60"
                  onClick={() => { if (offer) onUseRecommended(offer.recommendedHours); }}>
                  <CheckCircle2 aria-hidden="true" />
                  Use recommended hours
                </Button>
              )}
              {onZeroHours && (
                <Button type="button" variant="outline" size="sm" onClick={onZeroHours}
                  className="border-2 border-slate-400 bg-background font-semibold text-foreground shadow-sm hover:border-slate-500 hover:bg-slate-100 dark:border-slate-500 dark:hover:bg-slate-800">
                  <Ban aria-hidden="true" />
                  Agree zero-hours / Bank
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Recommendations do not change the agreement automatically. These actions change only agreed contracted hours, keeping desired hours and availability.</p>
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-notes`} className="text-sm font-medium">Availability notes</label>
        {onChange ? (
          <Textarea id={`${id}-notes`} value={availability.notes} rows={2} className="resize-none"
            placeholder="Travel limits, preferred days, or other availability details…"
            onChange={event => update({ ...availability, notes: event.target.value })} />
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{availability.notes || "No availability notes recorded."}</p>
        )}
      </div>
    </section>
  );
}
