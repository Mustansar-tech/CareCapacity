# Home Instead Care Capacity Dashboard - Definitive Logic Reference

This document serves as a technical and business reference for the dashboard's features, explaining **what** they do, **how** they work, and **why** they were implemented.

---

## 1. Dashboard Tab (Executive Overview)
**Purpose:** To give a high-level "health check" of the branch's staffing levels before diving into individual matches.

### Daily Capacity Summary
- **Why it was needed:** To quickly identify which days of the coming week are at risk. It prevents Business Developers from booking new clients on days where the branch is already "red-lined" (over-capacity).
- **Elements:**
    - **Total Hours:** Sum of all visit durations for that day.
    - **Staff Count:** Total unique Care Professionals (CPs) working that day.
    - **Capacity Percentage:** `(Scheduled Hours / Total Contracted Hours) * 100`.
- **Logic:** If the percentage exceeds 90%, the day is flagged as "At Risk" to warn against adding more intensive care packages.

### KPI Cards
- **Utilization Rate:** Average across all staff. Helps management see if they are under-employing staff (waste) or over-working them (burnout).
- **Available Gaps:** The total count of "Free Windows" found across the whole team.

---

## 2. BD Matrix Tab (The Visual Grid)
**Purpose:** A real-time "map" of who is where, used for quick phone enquiries where a Business Developer needs to say "Yes, we have someone free at 10:00 AM on Tuesday" within seconds.

### The Availability Grid
- **The Red/Green Logic:** 
    - **Green:** CP has at least 1 hour of contracted capacity left AND is free for the *entire* 1-hour block.
    - **Red:** CP is either physically busy with another client OR has reached their weekly contracted limit.
- **Why Standardized Blocks?** The company uses 11 standardized slots (e.g., 08:00-09:00). Even if a visit is 45 mins, it is mapped to these blocks to keep the UI clean and predictable.

### Hover/Tooltips
- **Logic:** Shows the *raw* free window strings from the system (e.g., "Free: 09:00-12:00, 14:00-17:00"). This is needed because a CP might be "Green" for a 10:00 slot but actually free all morning.

---

## 3. BD Matcher (Algorithmic Selection)
**Purpose:** To find the "Perfect Match" by balancing time, distance, and consistency.

### Flexible Window Matching (Updated)
- **Problem:** A CP free from 14:00-17:00 wasn't showing up for a 15:00 visit because the times didn't "align" exactly.
- **Solution:** "Container Logic." The system now checks if your 1-hour visit can fit *anywhere* inside the CP's free gap.
- **Rules:**
    1. **Exact:** Fits perfectly at the requested time.
    2. **Adjusted:** CP is free but needs a start-time shift (e.g., you asked for 15:30, they are free at 16:00).

### Scoring Rules (The 100-Point Scale)
- **Travel (15 pts):** Uses the "10km Rule." Closer is better.
- **Consistency (20 pts):** Prioritizes CPs who can do *all* requested days (e.g., Mon/Wed/Fri) so the client sees the same face.
- **Capacity (15 pts):** Prioritizes CPs with the most "Remaining Hours" to ensure they don't hit their limit mid-month.
- **Time (50 pts):** The primary driver. If they can't do the time, nothing else matters.

---

## 4. Multi-Visit Matcher
**Purpose:** For complex "Double-Up" visits (2 CPs needed) or high-intensity clients.

### Exclusion Logic
- **The Rule:** If "CP1" is filled by *Jane Doe*, the system **instantly excludes** *Jane Doe* from being suggested for "CP2" for that same visit.
- **Why:** To ensure the suggested team is physically possible (one person cannot be in two slots at once).

---

## 5. Postcode & Travel Scoring
**Purpose:** To minimize travel time and cost, which is the #1 complaint of Care Professionals.

### Proximity Logic
- **Geocoding:** Postcodes are converted to Map Coordinates.
- **Haversine Formula:** Calculates the "As the crow flies" distance between the CP's home and the Client's home.
- **Why not Google Maps Travel Time?** API costs and speed. Direct distance is a 95% accurate proxy for travel time in most branch areas and calculates instantly.

---

## 6. History & Data Management
**Purpose:** To track what was promised to clients and keep the database clean.

### Focused History View
- **Logic:** When you view a past enquiry for "Tuesday/Friday," the table hides Monday, Wednesday, Thursday, Saturday, and Sunday.
- **Why:** To remove "Visual Noise" and let the user focus only on the days that were actually matched.

### Data Management
- **Branch Switching:** When a user changes branches, all current analysis is wiped from memory to prevent data from Branch A leaking into Branch B.
