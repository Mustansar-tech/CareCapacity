---
name: Scotland postcode-sector territory boundaries
description: How to build accurate franchise/territory polygons from real Scottish postcode data (not buffered approximations)
---

Building an accurate franchise-territory polygon (one franchise/territory at a time, e.g. Glasgow North) from a
list of postcode sectors requires **real boundary geometry**, not circle-buffer-and-dissolve — buffering point
locations was tried previously and produced jagged/overlapping edges that got rolled back twice.

**Working method** (verified for Glasgow North):
1. National Records of Scotland's official postcode-sector boundary dataset is mirrored on ArcGIS Online as
   `NRS_Postcode_Sector` (service `https://services-eu1.arcgis.com/wdfNi1bRjans3E0y/arcgis/rest/services/NRS_Postcode_Sector/FeatureServer`),
   but its `DISTRICT` attribute field is empty in that mirror — the polygons exist but aren't labelled, so it's
   unusable directly for filtering by sector code.
2. The same host's `NRS_Postcode_Point` service (layer with `POSTCODE`, `EASTING`, `NORTHING` fields, OSGB36 grid,
   EPSG:27700) **is** fully populated at unit-postcode level and is the reliable data source. Fetch unit points
   for the target territory's postcode districts plus a wide surrounding margin (≥15km — 5km was not enough and
   let rural/edge sectors clip against the fetch bounding box instead of terminating at their true neighbour).
3. Compute a Voronoi tessellation (`d3-delaunay`) over all fetched points in BNG coordinates, clipped to the
   fetch bounding box. Each cell belongs to the sector of its source point (`district + first digit of inward
   code`, e.g. "G1 1"). This reproduces real non-overlapping, gap-free sector boundaries from unit-level points —
   the same principle real postcode boundaries are built on.
4. Union all cells whose sector is in the target territory's sector list (via `@turf/turf`) into one polygon,
   then reproject every coordinate from OSGB36/BNG to WGS84 (standard Airy1830 grid→lat/lon formula + 7-parameter
   Helmert transform — verified against known reference points, e.g. Glasgow ≈ 55.86°N/-4.25°E).
5. Both `d3-delaunay` and `@turf/turf` are one-off generation-time dependencies (installed with `--no-save`,
   removed again after generating the static `.geo.json`) — they are not runtime app dependencies.

**Why:** two earlier attempts at this exact feature (buffer-and-dissolve from postcode centroids) were rolled
back after shipping because edges were jagged/overlapping; Voronoi-from-real-unit-points avoids that failure mode
entirely since cells always tile without gaps or overlaps by construction.

**How to apply:** reuse this exact pipeline for each subsequent franchise/territory (Glasgow South, North
Lanarkshire, etc.) — one at a time, per the user's preferred incremental workflow. The territory data file lives
at `client/public/data/franchise-territories.geo.json` (a `FeatureCollection`, currently containing only Glasgow
North) and is rendered as a `GeoJSON` layer in `client/src/components/bd-matrix/CareProMap.tsx`, purely additive
to the existing marker/filter logic.

**Status: COMPLETE — all 20 territories built and shipped** (10 SUR + 10 Independent, incl. West Lothian added Aug 2026 after it was found missing from the original 19-territory Smappen source Excel — that Excel has since been updated too, so it stays the source of truth for future rebuilds). Independents carry `properties.group: "independent"`, always visible on the map in red/dashed; SUR ones show when ticked in the picker. Island territories (Inverclyde/N Ayrshire, W Dunbartonshire/Argyll & Bute) are MultiPolygons — keep all parts ≥1 km², never largest-only. Every territory is clipped to the Scotland national boundary (mandatory, per user, for consistency).
