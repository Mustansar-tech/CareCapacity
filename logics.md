# Care Capacity Dashboard - Logic Reference

This document outlines the core business logic, data processing rules, and matching algorithms used in the Home Instead Care Capacity Dashboard.

---

## 1. Data Ingestion & Extraction
**Source:** Excel files (Employee Weekly Schedule, Client Visits, etc.)
**Tab:** Dashboard (Upload Section)

### Processing Logic:
- **Date Normalization:** All dates are parsed and converted to a standard ISO format (YYYY-MM-DD).
- **Time Parsing:** Time strings (e.g., "09:00 - 10:30") are converted into minutes from midnight for mathematical comparison.
- **Contracted Hours:** Extracted from the "Contracted Hours" column. If missing, it defaults to the sum of scheduled hours for that week.
- **Scheduled Hours:** Calculated by summing the duration of all assigned visits for an employee across the selected date range.
- **Free Windows:** Calculated by identifying gaps between scheduled visits, travel time buffers, and the employee's defined shift start/end times.

---

## 2. Live Capacity Matrix (The "Grid")
**Tab:** BD Matrix (Top Section)

### Logic:
- **Red/Green Indicators:** 
    - **Green:** Employee has remaining contracted hours AND has a "Free Window" during the selected time block.
    - **Red:** Employee is either over-capacity (Scheduled > Contracted) or is currently assigned to another visit.
- **Time Blocks:** Displays availability across 11 standardized company time blocks (e.g., 08:00-09:00, 09:15-10:15).
- **Tooltips:** Hovering over a cell shows the specific "Free Window" strings (e.g., "Free: 14:00-17:30").

---

## 3. BD Matcher (The Algorithmic Ranking)
**Tab:** BD Matcher / Multi-Visit Matcher

### Matching Rules:
1. **Gender Preference (Hard Filter):** If "Female Only" is selected, all Male Care Professionals are excluded immediately.
2. **Availability Logic (Flexible Windows):**
    - **Exact Match:** The CP has a free window that *entirely contains* the requested visit time (e.g., free 14:00-17:00 for a 15:30-16:30 request).
    - **Adjusted Time:** The CP is free on the requested day, but not at the requested time. The system finds the closest available slot within 2.5 hours.
    - **Alternative Day:** The CP is free at the requested time, but on a different day than requested.

### Scoring Logic (Weighted 0-100):
- **50% Time Alignment:** High score for exact time matches, lower for "Adjusted Time."
- **20% Day Consistency:** Ratio of requested days covered vs. total days requested.
- **15% Remaining Capacity:** Bonus for CPs with more available contracted hours (Remaining = Contracted - Scheduled).
- **15% Travel Proximity:** Based on the distance between the CP's home postcode and the client's postcode.

---

## 4. Postcode & Travel Logic
**Mechanism:** Geocoding via Postcodes.io (with fallbacks)

### Logic:
- **Coordinates:** Every postcode is converted to Latitude/Longitude.
- **Proximity Score:** Uses the "Haversine" formula to calculate straight-line distance.
- **The "10km Rule":** Full 15-point travel bonus given for matches under 10km. Points drop off linearly as distance increases.
- **Storage:** Locations are cached in the database (`employee_locations` and `client_locations`) to avoid redundant API calls.

---

## 5. History & Tracking
**Tab:** History

### Logic:
- **Focused View:** The history view automatically filters the displayed schedule to show *only* the days relevant to that specific enquiry (e.g., if the enquiry was for Mon/Wed, it hides Tue/Thu/Fri).
- **Short Labels:** Gender preferences are shortened for UI density (e.g., "CP1: F Only").
- **Persistence:** All enquiries are saved with their full match results, allowing users to revisit potential matches even after new data is uploaded.

---

## 6. Route Optimization (Experimental)
**Tab:** Routing/Schedules

### Logic:
- **Greedy Assignment:** Visits are assigned to the nearest available employee who fits the time window.
- **Travel Time:** Calculates travel minutes between visits based on transport mode (Car: 35km/h, Walking: 15km/h).
- **Overheads:** Adds 15-minute buffers for public transport/walking transitions.
