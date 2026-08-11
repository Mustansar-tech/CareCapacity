---
name: franchise-territory-builder
description: Build an accurate franchise territory polygon for the Workforce & Client Map (CareProMap) from a list of Scottish postcode sectors, using real NRS unit postcode points + Voronoi tessellation. Use when the user asks to add/build the next territory (e.g. "do Glasgow South next", "add the North Lanarkshire territory") or to rebuild/fix an existing territory boundary.
---

# Franchise Territory Builder

Builds one franchise territory at a time as an accurate boundary polygon and appends it to
`client/public/data/franchise-territories.geo.json`, which `client/src/components/bd-matrix/CareProMap.tsx`
already renders as a GeoJSON layer. **Never** touch marker/filter/search logic — territories are purely visual.

Verified end-to-end for **Glasgow North** (Aug 2026). Repeat identically for each remaining territory.

## Why this method (do not deviate)

Buffer-and-dissolve around postcode centroids was tried twice and rolled back twice (jagged, overlapping
edges). The official `NRS_Postcode_Sector` ArcGIS mirror has EMPTY `DISTRICT` attributes (unusable for
lookups). The working approach: Voronoi tessellation over real NRS **unit postcode points** — cells tile
with no gaps/overlaps by construction, and grouping cells by sector reproduces true sector boundaries.

## Source of sector lists

`attached_assets/Postcodes_Only_Smappen_Import_1786452402272.xlsx` — 668 rows, columns:
`Address` ("G1 1, United Kingdom" → sector "G1 1"), `Territory` (19 full territory names),
`Franchise Group` (SUR vs "Independent Franchise"). Territory names in the Excel are the REAL names;
the `branches` DB table's `display_name` values are short forms (e.g. Excel "Stirling and Falkirk" vs
UI "Stirling", "South Ayrshire and Kilmarnock" vs "Ayr") — reconcile per territory: the geojson feature
gets `properties.branch` = branch slug (if it's a SUR branch) and `properties.realName` = the Excel name.
Independent (non-SUR) franchises have no branch row; style them red when they're eventually added.

## Pipeline (run per territory)

Working scripts live in `reference/` next to this file. Steps:

1. **Install one-off deps** (generation-time only, remove after):
   `npm install --no-save d3-delaunay @turf/turf`
2. **Extract the territory's sector list** from the Excel (`Address` column, strip ", United Kingdom")
   into a JSON array like `["G1 1","G1 2",...]`. Save to `work/<slug>-sectors.json`.
3. **Fetch unit postcode points**: run `reference/fetch-points.mjs` (edit the district list / bbox at the
   top). It queries the NRS_Postcode_Point FeatureServer:
   `https://services-eu1.arcgis.com/wdfNi1bRjans3E0y/arcgis/rest/services/NRS_Postcode_Point/FeatureServer/41/query`
   Fields: `POSTCODE, EASTING, NORTHING` (EPSG:27700 British National Grid). First fetch the territory's
   own districts to get its bbox, then fetch ALL points in that bbox expanded by a **≥15000 m margin**
   (5 km was not enough — edge sectors clipped against the fetch box instead of their true neighbours).
4. **Build the polygon**: run `reference/build-territory.mjs`. It:
   - computes a Voronoi tessellation (d3-delaunay) over all context points in BNG metres, clipped to the fetch bbox
   - assigns each cell to its point's sector = `outward code + " " + first digit of inward code`
   - unions the cells of the target sectors (turf.union), reprojects BNG→WGS84 via `reference/bng.mjs`
5. **Mandatory sanity checks — all must pass before shipping:**
   - build log: every target sector matched (`found N / N`, `missing []`)
   - `turf.booleanValid` true, `turf.kinks(...)` = 0 features
   - bbox plausible for the area; if the polygon's extreme point sits ON the fetch-bbox edge
     (convert the clip bound with bng.mjs to compare), the margin was too small — refetch with a bigger one
   - area in a sane range (Glasgow North ≈ 204 km²; urban territories 100–600 km², rural larger)
   - visual check: render as a plain inline SVG in a temp `client/public/territory-preview.html`
     and screenshot `/territory-preview.html` (no auth needed for public files). Do NOT use CDN
     leaflet in the preview — the app's CSP blocks external scripts/styles. Delete the file after.
   - where the new territory borders an already-built one, verify the shared edge meets cleanly (no overlap/gap)
6. **Append** the feature to the `features` array of `client/public/data/franchise-territories.geo.json`
   (never overwrite existing features) with `properties: { branch: "<slug or null>", realName: "<Excel name>" }`.
7. **Cleanup**: delete work scripts' output dirs, delete the preview html, `npm uninstall d3-delaunay @turf/turf`
   (they must not stay in package.json — runtime app never uses them), run `npx tsc --noEmit`, restart the
   `Start application` workflow, confirm clean logs.
8. Show the user the SVG/preview screenshot and wait for their approval before moving to the next territory.

## Verified reference values

- BNG→WGS84 converter checks: Glasgow George Square (E 259208, N 665379) → ≈ 55.8609°N, −4.2514°W;
  any reimplementation must reproduce known points to <20 m before use.
- Glasgow North (64 sectors: G1, G2, G3, G4, G11–G14, G20–G23, G31 1, G40, G61, G62, G64, G66):
  bbox ≈ [−4.4004, 55.8345, −4.0753, 56.0218], area ≈ 203.5 km², single Polygon.

## Rendering (already in place)

`CareProMap.tsx` fetches `/data/franchise-territories.geo.json` on mount and renders it with a violet
border (`#7c3aed`, weight 2.5, fillOpacity 0.08) plus a sticky tooltip from `properties.realName`, and a
"Territory border" legend row. When independent (red) franchises are added, extend the style function to
key off a `properties.group` field rather than adding a second layer.
