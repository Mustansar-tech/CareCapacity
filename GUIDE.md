# Care Capacity Dashboard — User Guide

## Getting Started

When you open the app you will see a short splash screen, then land on the main dashboard. At the top of the page there is a navigation bar with:
- The app logo (click to return to the Overview tab)
- The **Branch Selector** dropdown — choose the correct franchise branch before doing anything else
- A dark/light mode toggle

Every piece of data in the app — uploads, schedules, history, employees, clients — is completely separate per branch. Always confirm you are on the right branch before working.

---

## Uploading Data (Data Management)

This is the first step each week. Navigate to **Data Management** to upload the Excel exports from your care management system.

### Files Required

| What to upload | Where it comes from |
|---|---|
| **Availability Export** | Your care management system's availability/rota report |
| **Care Pro Guaranteed Hours** | The guaranteed hours export (contains all scheduled visits) |
| **CG Data Export** | The caregiver data export (contains home postcodes and transport modes) |
| **Hours by Service Type** *(optional)* | Client demand report for capacity gap analysis |

### What Happens After Upload

1. The system reads all three files and links them together using employee names.
2. Every employee's home postcode and client addresses are geocoded (converted to map coordinates). This is cached so it only happens once per address.
3. Capacity is calculated for each employee and each day of the week.
4. KPIs, daily summaries, and employee-level detail are stored in the database.
5. You are redirected to the dashboard with the newly processed week selected.

### Tips
- Upload all files at the same time for best results.
- If an employee appears in the schedule file but not in the CG Data file, they are treated as an ad-hoc employee — their hours are still counted.
- Night visits, sleep-ins, and waking nights are automatically excluded from capacity totals. You do not need to remove them manually.
- Cancelled visits (anything with a value in the Cancellation Description column) are excluded from scheduled hours automatically.

---

## Overview Tab

The Overview tab is the executive summary for the selected week.

### KPI Cards
Nine headline numbers are shown at the top:
- **Net Capacity** — Total available hours after deducting leave, sickness, and unavailability
- **Client Required** — Hours of care clients need that week
- **Scheduled** — Hours actually delivered
- **Gap** — Difference between net capacity and what clients need
- **Unavailability** — Hours lost to personal appointments and similar
- **Sickness** — Hours lost to sick days
- **Holidays** — Hours lost to annual leave
- **Other Scheduled** — Non-client visits (office time, meetings, etc.)
- **Capacity After Scheduling** — How much capacity remains after all scheduled visits

### How Capacity is Calculated
- **Gross capacity** = Employee's contracted daily hours × working days
- **Net capacity** = Gross capacity − Unavailability − Sickness − Holidays
- Deductions are capped at contracted hours — an employee cannot have negative capacity
- A full sick day or holiday wipes out that day's capacity entirely

---

## Daily Capacity Tab

Shows a day-by-day breakdown of the selected week.

The table lists every active employee with their status, time windows, scheduled hours, and net capacity for each day.

- **Green** = employee available and scheduled
- **Amber** = employee has reduced capacity (partial unavailability)
- **Red** = employee fully absent (holiday, sick, full-day unavailability)
- **Gender indicators** help quickly see the gender balance available each day
- **Transport mode icons** show whether each employee drives, walks, or uses public transport

Click any employee row to expand their detail for that day.

---

## Employee Summary Tab

One row per employee for the whole week. Shows:
- Contracted vs scheduled hours comparison
- Free time windows — gaps in the schedule where new clients could be added
- Cancelled visits with times shown
- Transport mode and gender

This tab is useful for identifying employees who are under-utilised and could take on additional clients.

---

## Schedules Tab

This is where you generate and view the optimised weekly schedule.

### Selecting a Week
Use the week picker at the top to choose which week to generate for. The system automatically pulls client visits and employee availability for that period.

### Generating a Schedule

1. Click **Generate Schedule**.
2. The system first pre-loads real road travel times for car-driving employees (using ORS Matrix — a batch calculation covering all employee-to-client combinations).
3. The scheduling engine then assigns visits to employees, respecting:
   - Time windows (when each client needs their visit)
   - Travel time caps (45 minutes maximum for car, 60 minutes for walkers and public transport)
   - Contracted daily hours
   - Gender requirements
   - Statutory 20-minute rest after 6 consecutive hours of work
4. Once the schedule is displayed, walker and public transport employees' routes are refined using the TravelTime API. This uses the actual bus and train timetables for the correct day of the week — so a Saturday schedule checks Saturday's (usually reduced) services.
5. A banner says "Verifying walker travel times…" while this is happening. Once complete, you see a toast notification with the count of routes verified.
6. The schedule is saved to the database automatically.

### Reading the Schedule

The schedule shows a horizontal swimlane per employee, one column per day of the week. Each visit is shown as a card with:
- Client name
- Start and end times
- Travel time arrow between visits (shown in minutes)
- A home icon at the start and end of each day

**Amber "⚠ Long travel" badge** — if a walker or public transport employee has a route leg that exceeds 60 minutes after TravelTime refinement, that visit is flagged. The schedule manager should review whether the assignment is realistic.

### Travel Data Source Badge

Below the generate button there is a small panel showing which data sources were used:
- **ORS Matrix** — car routes, batch pre-warmed
- **TravelTime API** — walker/public transport routes, queried post-schedule
- **Heuristic Estimate** — Haversine straight-line fallback (used only if APIs are unavailable)

If a route is marked as heuristic, its travel time is a rough estimate. Real road or transit time may be longer.

### Unallocated Visits

Visits the engine could not assign appear in the **Unallocated** panel below the schedule. Reasons include:
- No employee available in the required time window
- All nearby employees exceed the travel time cap for that client's location
- Gender requirement cannot be met
- Visit would push employee over their contracted daily hours

Review unallocated visits manually and reassign if needed.

### Adjusting Scheduling Preferences

In the Schedules tab settings you can add or remove service types that should be excluded from scheduling (for example: "Office Hours", "Sleep In", "Secondary"). These exclusions are saved per branch.

---

## BD Matrix Tab (Business Development)

The BD Matrix helps you quickly answer the question: "Which of my care pros could take on a new client?"

### Reading the Heatmap

A grid shows employees (rows) against days of the week (columns). Each cell shows how many hours of free capacity that employee has on that day. Darker cells = more availability.

### Finding a Match for a New Client Enquiry

Click **New Enquiry** to open the matching tool.

**Basic enquiry (single visit):**
1. Enter the client's postcode.
2. Select which days they need care.
3. Set the preferred arrival time window (e.g. 09:00–11:00).
4. Set visit duration in minutes.
5. Set gender preference if required.
6. Click **Find Matches**.

**Multi-visit enquiry (complex packages):**
Use the visit tabs at the top to add up to 5 separate visit slots. Each visit can have its own days, time window, duration, number of care pros needed, and gender preference. All visits are matched simultaneously.

### Matching Results

Results are ranked by suitability. For each matched employee you see:
- Which days and times they are available
- Their distance from the client's postcode
- Whether they meet the gender requirement
- Their current scheduled hours vs their contracted hours

Click **Save Enquiry** to keep a record of the search and results in the history panel on the right side of the BD Matrix.

---

## Analytics Tab

Interactive charts covering:
- Daily capacity trends over time
- Scheduled hours vs net capacity comparison
- Service type breakdown
- Employee utilisation distribution

Use the date range picker to compare different weeks or periods.

---

## Export Tab

Downloads an Excel workbook with multiple sheets:
- **Cleaned Data** — processed records from all uploaded files
- **Daily Summary** — the KPI data for each day
- **Employee Detail** — per-employee scheduled hours and capacity

The export uses the currently selected week and branch.

---

## History and Data Retention

The **History** panel (accessible from the navigation) lists all previously processed weeks for the current branch. Click any week to load it.

To free up space, use **Clean Up Old Data** to delete analyses older than a specified number of months. A preview shows how many records would be removed before you confirm.

---

## Frequently Asked Questions

**Why does the schedule take a minute to generate?**
The system is fetching real road travel times for every employee-to-client combination before running the optimisation. This is done in batch and is much faster than individual calls, but with many employees and clients it still takes a few seconds. Walker routes are then verified against live bus/train timetables after the initial schedule is built.

**Why are some walker routes still showing estimated times?**
If the TravelTime API is unavailable or a route is entirely on foot over a very short distance, the system falls back to a straight-line estimate. The "Travel data source" badge at the top of the schedule will show "Heuristic Estimate" for those routes.

**Why is a visit in Unallocated when I know an employee is free?**
The most common reasons are:
- The employee's location is more than 60 minutes travel from the client (walker) or more than 45 minutes (car driver)
- The visit time window is too narrow to fit given the employee's existing commitments that day
- The gender requirement cannot be met by any available employee

**Can I override the schedule?**
Not directly in the current version — the schedule must be regenerated with adjusted inputs (availability, time windows, or employee data) to change assignments. Manual overrides are planned.

**Why do Saturday and Sunday routes look different from weekday routes?**
For walker and public transport employees, the system uses the actual day's bus and train timetables when calling the TravelTime API. Weekend services typically run less frequently, so journeys take longer. This is intentional — the schedule should reflect real-world Sunday bus availability, not assume a weekday timetable.

**What does "ORS Matrix (412 · 100%)" mean in the travel sources badge?**
It means 412 car route pairs were pre-loaded from the ORS Matrix API and cover 100% of the car employee assignments. If walker routes are also present, you will see a second entry for "TravelTime API" with the count of walker pairs that were verified.
