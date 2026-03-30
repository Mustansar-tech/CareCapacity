# Complete Geocoding System Flow

## Overview
There are **4 interconnected geocoding systems** that work together when files are uploaded:
1. **Employee Home Locations** (from CG Data Export)
2. **Client Service Locations** (from Guaranteed Hours Excel)
3. **Geocode Cache** (shared repository for lat/lng coordinates)
4. **CP Scheduled Visits** (stores visit details with coordinates from client locations)

---

## 1. EMPLOYEE HOME LOCATIONS

### Where it comes from
- **Source**: CG Data Export file (uploaded as `guaranteedData`)
- **Columns extracted**: 
  - `CAREGiver Name` (employee name)
  - `PostCode` (home postcode)
  - `TransportModeDescription` (car/walker/public transport)
  - `Title` (for deriving gender)

### Geocoding Process
```
CG Data Upload
    ↓
Loop through CG rows
    ↓
For each employee with postcode:
    1. Call geocodeWithFallback(postcode)
    2. Check geocode_cache for exact postcode match
    3. If not cached → call postcodes.io API
    4. Save result to geocode_cache
    5. Store in employee_locations table with lat/lng
```

### Key Properties
- **Table**: `employee_locations`
- **Cleared before upload**: YES (line 3445 in pipeline.ts)
  - Old employees removed; fresh data replaces it
- **Geocoding**: Via `geocodeWithFallback` function
- **Cache used**: YES — `geocode_cache` (shared across employee/client)
- **Used by**: Travel time calculations, route planning, departure points

### Example
```
Employee: "John Smith"
  HomePostcode: "G41 2AH"
  TransportMode: "car"
  ↓ geocodeWithFallback
  geocode_cache lookup: "postcode:G41 2AH" → HIT/MISS
  If MISS → postcodes.io API → lat: 55.8467, lng: -4.3078
  ↓
  employee_locations.upsert(
    employeeName: "John Smith",
    homeLat: "55.8467",
    homeLng: "-4.3078",
    homePostcode: "G41 2AH",
    transportMode: "car"
  )
```

---

## 2. CLIENT SERVICE LOCATIONS

### Where it comes from
- **Source**: Guaranteed Hours Excel workbook (GH file)
- **Columns extracted**:
  - `Service Location Name` or `Client Address` (client name/identifier)
  - `Service Location Address` (full address)
  - `Postcode` (if present)

### Geocoding Process (TWO-STEP)

**STEP 1: Extract & Store Without Geocodes First**
```
Raw GH Excel rows (ALL rows, not filtered)
    ↓
Skip cancelled rows + secondary multiple care
    ↓
Extract postcode from address using regex patterns
    ↓
Store in client_locations WITHOUT lat/lng yet:
  {
    clientName: "Millson Care Ltd",
    addressLine: "123 High St",
    postcode: "G41 2AH",
    lat: null,      ← Not geocoded yet
    lng: null       ← Not geocoded yet
  }
```

**STEP 2: Batch Geocode Missing Coordinates**
```
For each client in client_locations where lat/lng = null:
    1. Call geocodeWithFallback(postcode)
    2. Check geocode_cache for "postcode:G41 2AH"
    3. If cached (previous employee already used it) → INSTANT REUSE
    4. If not cached → postcodes.io API
    5. Save to geocode_cache
    6. Update client_locations.lat/lng with the result
```

### Key Properties
- **Table**: `client_locations`
- **Cleared before upload**: YES (line 3446 in pipeline.ts)
  - Ensures old inactive clients removed
- **Geocoding**: Via `geocodeWithFallback` function (same as employees)
- **Cache used**: YES — `geocode_cache` (SHARED - reuses employee geocodes)
- **Used by**: 
  - CP scheduled visits (immediately stores coordinates)
  - Travel time calculations
  - BD Matcher forward travel checks

### Example
```
Client: "Millson Care Ltd"
  Address: "123 High St, Glasgow G41 2AH"
  ↓ Extract postcode
  postcode: "G41 2AH"
  ↓ Initial store (no geocoding yet)
  client_locations.upsert({
    clientName: "Millson Care Ltd",
    addressLine: "123 High St, Glasgow",
    postcode: "G41 2AH",
    lat: null, lng: null
  })
  ↓ Batch geocoding phase
  geocodeWithFallback("G41 2AH")
    → cache lookup → "postcode:G41 2AH"
    → FOUND (employee used it already!) → lat: 55.8467, lng: -4.3078
  ↓ Update client_locations
  client_locations.upsert({
    clientName: "Millson Care Ltd",
    addressLine: "123 High St, Glasgow",
    postcode: "G41 2AH",
    lat: "55.8467",
    lng: "-4.3078"
  })
```

---

## 3. GEOCODE CACHE

### What it is
- **Table**: `geocode_cache`
- **Purpose**: Centralized repository of postcode → lat/lng mappings
- **Scope**: Branch-scoped (key = `${branchId}:postcode:${postcode}`)
- **Data source**: 
  - postcodes.io API (authoritative)
  - Previous uploads (cached for reuse)

### How it works
```
geocodeWithFallback("G41 2AH", storage, branchId)
  ↓
  1. Check cache: storage.getGeocode(branchId, "postcode:G41 2AH")
  2. If HIT → return cached lat/lng instantly
  3. If MISS → call postcodes.io API
  4. Store result: storage.saveGeocode({
       branchId,
       key: "postcode:G41 2AH",
       lat, lng,
       source: "postcodes.io"
     })
  5. Return to caller
```

### Key Properties
- **Shared across**: Employees + Clients + CP Scheduled Visits + Routes + BD Matcher
- **Persistence**: Stays between uploads (NOT cleared)
- **Cost efficiency**: API call made only once per unique postcode per branch
- **Cache hit example**: 
  - Employee John at "G41 2AH" → call API, save to cache
  - Client Millson at "G41 2AH" → lookup cache → INSTANT (no API call)

---

## 4. CP SCHEDULED VISITS

### What it is
- **Table**: `cp_scheduled_visits`
- **Purpose**: Store employee visit details for BD Matcher to calculate realistic departure points
- **Scope**: Per-date, rolling 8-week retention
- **Extracted from**: Guaranteed Hours Excel (during pipeline processing)

### Data stored
```
{
  branchId,
  cpName,              ← Employee name
  clientName,          ← Client name (COULD be office/admin)
  clientLat,           ← Coordinates from client_locations lookup
  clientLng,           ← Coordinates from client_locations lookup
  clientPostcode,
  date,
  startTime,
  endTime
}
```

### Geocoding for CP Visits

**FOR REGULAR CLIENT VISITS:**
```
GH row: "John Smith", "Millson Care Ltd", "09:00", "10:00"
    ↓
1. Extract to schedule map (extractEmployeeVisitsFromGHExcel)
2. Lookup client location: storage.getClientLocationByName(branchId, "Millson Care Ltd")
3. If found → use its lat/lng:
     clientLocation = { lat: 55.8467, lng: -4.3078 }
4. Store in cp_scheduled_visits:
     {
       cpName: "John Smith",
       clientName: "Millson Care Ltd",
       clientLat: 55.8467,
       clientLng: -4.3078,
       ...
     }
```

**FOR OFFICE/ADMIN VISITS (after recent fix):**
```
GH row: "John Smith", "., ." (office), "12:00", "12:30"
    ↓
1. Extract to schedule map (now includes office visits)
2. Lookup location: storage.getClientLocationByName(branchId, "., .")
3. If office name matches stored client → use its coordinates
   If no match → store with clientLat/Lng = null
4. Store in cp_scheduled_visits:
     {
       cpName: "John Smith",
       clientName: "., .",
       clientLat: null,  ← No coords (office address not in system)
       clientLng: null,  ← OR if office WAS stored as client → use those
       ...
     }
```

### Key Properties
- **Geocoding source**: Looks up from `client_locations` table (which was already geocoded)
- **No API calls**: Uses pre-geocoded client coordinates
- **Cleared before upload**: Upserted per-date (rolling 8-week window)
- **Used by**: 
  - BD Matcher `getDeparturePoint()` to find last visit location
  - Travel time calculations for next visit forward-travel checks
  - Weekly plan display (showing visit details)

---

## SUMMARY: Do they all get the same geocodes?

### YES — via the shared `geocode_cache`

```
┌─────────────────────────────────────┐
│     POSTCODE: "G41 2AH"             │
└──────────────────┬──────────────────┘
                   │
        ┌──────────┴──────────────────┬──────────────┐
        │                             │              │
  Employee Home              Client Location    CP Visit Location
  john_smith.lat            millson.lat         visit.clientLat
  = 55.8467                 = 55.8467           = 55.8467
  
  All use the SAME coordinates from geocode_cache!
```

### Key differences
| Component | Source | Geocoding | Cache Usage | Table Cleared |
|-----------|--------|-----------|-------------|---------------|
| **Employee Locations** | CG Data (postcode) | `geocodeWithFallback` | YES - saves & reuses | YES (fresh upload) |
| **Client Locations** | GH Excel (address+postcode) | `geocodeWithFallback` | YES - saves & reuses | YES (fresh upload) |
| **Geocode Cache** | postcodes.io API | Once per postcode | Central store | NO (persistent) |
| **CP Scheduled Visits** | GH Excel (client names) | Lookup `client_locations` | Indirect (uses client coords) | Upserted per-date |

---

## FLOW DIAGRAM: Complete Upload Process

```
USER UPLOADS FILES
    │
    ├─→ [CG Data Export]
    │      ├─ Extract employee: "John Smith", postcode: "G41 2AH"
    │      ├─ geocodeWithFallback("G41 2AH")
    │      │   ├─ Check geocode_cache → MISS
    │      │   ├─ API call → lat: 55.8467, lng: -4.3078
    │      │   └─ Save to geocode_cache
    │      └─ Store in employee_locations
    │
    ├─→ [GH Excel - Client Locations]
    │      ├─ Extract client: "Millson Care Ltd", address: "123 High St, G41 2AH"
    │      ├─ Extract postcode: "G41 2AH"
    │      ├─ Store in client_locations (lat/lng = null initially)
    │      ├─ Mark for geocoding: "Millson Care Ltd"
    │      ├─ geocodeWithFallback("G41 2AH")
    │      │   ├─ Check geocode_cache → HIT! (employee already cached it)
    │      │   └─ Return: lat: 55.8467, lng: -4.3078 (no API call!)
    │      └─ Update client_locations with coordinates
    │
    ├─→ [GH Excel - CP Scheduled Visits]
    │      ├─ Visit row: "John Smith", "Millson Care Ltd", "09:00", "10:00"
    │      ├─ Extract to schedule map
    │      ├─ Lookup "Millson Care Ltd" in client_locations
    │      │   → Found: lat: 55.8467, lng: -4.3078
    │      └─ Store in cp_scheduled_visits with those coordinates
    │
    └─→ [Travel Time Pre-warming Cache]
           ├─ All 4 coordinates (employees, clients, visits) → same postcode-based geocodes
           ├─ Uses pre-warmed cache for efficient routing
           └─ BD Matcher ready to use actual departure points

RESULT: Employee, Client, Visit, and Route all use SAME lat/lng for the postcode!
```

---

## WHICH GEOCODING IS SKIPPED?

### ✅ Never skipped
- Employee home locations (always geocoded if postcode exists)
- Client locations (always geocoded if address/postcode exists)

### ⏭️ Sometimes skipped (no coordinates stored)
- **Office/admin visits**: If the office name ("., ." or "Visit, Office") doesn't exist as a client location entry
  - They're still IN cp_scheduled_visits, but `clientLat/clientLng = null`
  - Used by `getDeparturePoint` to track "is the CP still on-duty?" (end time matters)
  - But no travel-time routing calculated from office location itself

---

## DO WE GEOCODE ONCE AND REUSE, OR SEPARATELY?

### **GEOCODE ONCE AND REUSE** ✅

```
Timeline during one upload:
────────────────────────────────────────────────────────────

FIRST GEOCODE (Employee John at G41 2AH):
  geocodeWithFallback("G41 2AH")
    → Not in cache yet
    → API call to postcodes.io
    → Get: lat 55.8467, lng -4.3078
    → SAVE to geocode_cache
    → Store in employee_locations

SECOND LOOKUP (Client Millson at G41 2AH):
  geocodeWithFallback("G41 2AH")
    → Already in cache! ✅
    → INSTANT return: lat 55.8467, lng -4.3078
    → NO API CALL
    → Store in client_locations

THIRD LOOKUP (CP Visit at G41 2AH location):
  storage.getClientLocationByName("Millson Care Ltd")
    → Returns: lat 55.8467, lng -4.3078 (already geocoded by step 2)
    → Store in cp_scheduled_visits
    → NO API CALL

ACROSS UPLOADS (Future weeks/months):
  Next upload: Employee at G41 2AH again
    → geocodeWithFallback("G41 2AH")
    → Cache HIT from MONTHS ago
    → REUSE instantly
    → ZERO API CALLS FOR REPEAT POSTCODES
```

### Cost Efficiency
- **Per unique postcode**: 1 API call maximum
- **Shared across**: All employees, all clients, all visits, all routes
- **Persistent**: Never re-geocode the same postcode in the same branch

---

## KEY TAKEAWAY

**All four systems share a single source of truth: the `geocode_cache` table.**

When you upload:
1. **Employee postcodes** → geocoded via `geocodeWithFallback` → saved to cache
2. **Client postcodes** → geocoded via `geocodeWithFallback` → **REUSES from cache**
3. **CP Scheduled Visits** → uses pre-geocoded **client coordinates** (no new geocoding)
4. **Travel time calculations** → uses the **same cached coordinates**

**Result**: Efficient, single-source geocoding with zero redundant API calls.
