#!/usr/bin/env node
/**
 * Regenerates client/public/data/franchise-territories.geo.json — the static,
 * best-guess territory polygons drawn on the Workforce & Client Map for each
 * Scottish franchise. No exact postcode-level franchise boundary data exists,
 * so most territories are unions of whole Scottish council areas (from the
 * ONS Open Geography Portal, Local Authority Districts Dec 2023, cached at
 * scripts/data/scotland-councils.geojson). Two franchises split a single
 * council area and need an internal cutline:
 *
 *  - Glasgow North / Glasgow South split along the actual River Clyde
 *    through the city (Whiteinch to Dalmarnock), not a straight line.
 *  - West Fife and Kinross is separated from the (untracked) "East Fife"
 *    area along the Lomond Hills ridge running south to the Firth of Forth
 *    coastline near Kinghorn, not a straight longitude cut.
 *
 * These cutlines are hand-picked approximations from public landmark/place
 * coordinates, not surveyed franchise boundaries — see the "Refine
 * approximate franchise territory borders" follow-up task for upgrading to
 * authoritative data if Sur Group ever supplies it.
 *
 * Run with: node scripts/generate-franchise-territories.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COUNCILS_PATH = path.join(__dirname, 'data', 'scotland-councils.geojson');
const OUT_PATH = path.join(__dirname, '..', 'client', 'public', 'data', 'franchise-territories.geo.json');

const councils = JSON.parse(fs.readFileSync(COUNCILS_PATH, 'utf8'));

function byName(name) {
  const f = councils.features.find(f => f.properties.LAD23NM === name);
  if (!f) throw new Error(`Council not found: ${name}`);
  return turf.feature(f.geometry);
}

function unionAll(features) {
  const list = features.filter(Boolean);
  let acc = list[0];
  for (let i = 1; i < list.length; i++) {
    acc = turf.union(turf.featureCollection([acc, list[i]]));
  }
  return acc;
}

// --- Generic "split a polygon by a hand-drawn line" helper -----------------
// Builds the half of `poly`'s bounding box that lies on one side of an
// open polyline `linePts` ([lng,lat][]), by closing the line into a simple
// (non-self-intersecting) polygon against the padded bbox edges, then
// intersecting with the real council polygon. `axis`:
//   'ns' — linePts run broadly west→east; splits the area into north/south
//          halves (used for the Clyde, which separates Glasgow N/S).
//   'we' — linePts run broadly south→north; splits into west/east halves
//          (used for the Lomond Hills line, which separates Fife W/E).
function splitPolygonByLine(poly, linePts, axis, keep) {
  const [minX, minY, maxX, maxY] = turf.bbox(poly);
  const pad = 0.3; // degrees — generous so the closing edges never re-enter the polygon
  const extMinX = minX - pad, extMaxX = maxX + pad, extMinY = minY - pad, extMaxY = maxY + pad;

  let ring;
  if (axis === 'ns') {
    const sorted = [...linePts].sort((a, b) => a[0] - b[0]); // west → east
    const first = sorted[0], last = sorted[sorted.length - 1];
    ring = keep === 'north'
      ? [[extMinX, extMaxY], [extMinX, first[1]], ...sorted, [extMaxX, last[1]], [extMaxX, extMaxY], [extMinX, extMaxY]]
      : [[extMinX, extMinY], [extMinX, first[1]], ...sorted, [extMaxX, last[1]], [extMaxX, extMinY], [extMinX, extMinY]];
  } else {
    const sorted = [...linePts].sort((a, b) => a[1] - b[1]); // south → north
    const first = sorted[0], last = sorted[sorted.length - 1];
    ring = keep === 'west'
      ? [[extMinX, extMinY], [first[0], extMinY], ...sorted, [last[0], extMaxY], [extMinX, extMaxY], [extMinX, extMinY]]
      : [[extMaxX, extMinY], [first[0], extMinY], ...sorted, [last[0], extMaxY], [extMaxX, extMaxY], [extMaxX, extMinY]];
  }

  const halfPlane = turf.polygon([ring]);
  const kinkCheck = turf.kinks(halfPlane);
  if (kinkCheck.features.length > 0) {
    throw new Error(`splitPolygonByLine produced a self-intersecting half-plane (axis=${axis}, keep=${keep}) — check that linePts are monotonic along the split axis.`);
  }
  return turf.intersect(turf.featureCollection([poly, halfPlane]));
}

// --- Glasgow North/South: split along the real River Clyde -----------------
// 20 waypoints tracing the Clyde's course through Glasgow from Whiteinch
// (west) to Dalmarnock (east), approximated from known landmarks/bridges
// (Squinty Bridge, SEC/Hydro, Broomielaw, Jamaica St Bridge, Glasgow Green,
// Bridgeton). The river's real course dips to ~55.852-55.854°N through the
// city centre before rising slightly again near Dalmarnock.
const CLYDE_LINE = [
  [-4.3450, 55.8695], // Whiteinch
  [-4.3320, 55.8676],
  [-4.3190, 55.8660], // Partick
  [-4.3070, 55.8636], // Govan crossing
  [-4.2970, 55.8608], // Pacific Quay / Squinty Bridge
  [-4.2880, 55.8600], // Finnieston
  [-4.2820, 55.8592], // SEC Armadillo / Hydro
  [-4.2760, 55.8583],
  [-4.2690, 55.8579], // Anderston Quay
  [-4.2620, 55.8578], // Broomielaw
  [-4.2550, 55.8578], // Jamaica St Bridge (city centre)
  [-4.2490, 55.8568], // Victoria Bridge
  [-4.2430, 55.8553], // Albert Bridge
  [-4.2370, 55.8542], // Glasgow Green
  [-4.2300, 55.8532], // People's Palace / Bridgeton
  [-4.2230, 55.8524], // Dalmarnock Rd Bridge
  [-4.2160, 55.8522],
  [-4.2100, 55.8528], // Dalmarnock
  [-4.2040, 55.8545],
  [-4.1980, 55.8565], // approaching Cambuslang/Rutherglen boundary
];

// --- West Fife / Kinross: split along the Lomond Hills ridge --------------
// 16 waypoints from the West Lomond ridge southward to the Firth of Forth
// coastline near Kinghorn, approximating the boundary between "West Fife
// and Kinross" (Dunfermline, Cowdenbeath, Kirkcaldy — tracked branch) and
// the untracked "East Fife" area (St Andrews, Cupar) further east.
const LOMOND_LINE = [
  [-3.2225, 56.2410], // West Lomond
  [-3.2100, 56.2200],
  [-3.2020, 56.2050],
  [-3.1950, 56.1900],
  [-3.1900, 56.1750],
  [-3.1850, 56.1600],
  [-3.1800, 56.1450], // Glenrothes area
  [-3.1750, 56.1300],
  [-3.1700, 56.1150],
  [-3.1650, 56.1050],
  [-3.1600, 56.0950],
  [-3.1550, 56.0870],
  [-3.1500, 56.0800],
  [-3.1450, 56.0750],
  [-3.1400, 56.0720],
  [-3.1350, 56.0700], // Kinghorn coastline
];

const glasgow = byName('Glasgow City');
const glasgowNorthPart = splitPolygonByLine(glasgow, CLYDE_LINE, 'ns', 'north');
const glasgowSouthPart = splitPolygonByLine(glasgow, CLYDE_LINE, 'ns', 'south');

const fife = byName('Fife');
const fifeWestPart = splitPolygonByLine(fife, LOMOND_LINE, 'we', 'west');

const branches = [
  { branch: 'aberdeen', realName: 'Aberdeen', parts: [byName('Aberdeen City')] },
  { branch: 'south-ayrshire', realName: 'South Ayrshire and Kilmarnock', parts: [byName('South Ayrshire'), byName('East Ayrshire')] },
  { branch: 'east-lothian', realName: 'East Lothian and Midlothian', parts: [byName('East Lothian'), byName('Midlothian')] },
  { branch: 'glasgow-north', realName: 'Glasgow North', parts: [glasgowNorthPart, byName('East Dunbartonshire')] },
  { branch: 'glasgow-south', realName: 'Glasgow South', parts: [glasgowSouthPart, byName('South Lanarkshire'), byName('East Renfrewshire')] },
  { branch: 'north-lanarkshire', realName: 'North Lanarkshire and Glasgow East', parts: [byName('North Lanarkshire')] },
  { branch: 'perthshire', realName: 'Perthshire', parts: [byName('Perth and Kinross')] },
  { branch: 'scottish-borders', realName: 'Scottish Borders', parts: [byName('Scottish Borders')] },
  { branch: 'stirling-falkirk', realName: 'Stirling and Falkirk', parts: [byName('Stirling'), byName('Falkirk'), byName('Clackmannanshire')] },
  { branch: 'west-fife-kinross', realName: 'West Fife and Kinross', parts: [fifeWestPart] },
];

const outFeatures = branches.map(({ branch, realName, parts }) => {
  const merged = unionAll(parts);
  // precision 6 (~0.11m) avoids collapsing distinct nearby vertices into the
  // same rounded point, which otherwise creates spurious self-intersections
  // (precision 5 does this for a few councils, e.g. Aberdeen City).
  const rounded = turf.truncate(merged, { precision: 6, coordinates: 2 });
  return turf.feature(rounded.geometry, { branch, realName });
});

// --- Validate: abort on any self-intersecting ring before writing anything.
let hasKinks = false;
for (const feature of outFeatures) {
  const kinkResult = turf.kinks(feature);
  if (kinkResult.features.length > 0) {
    hasKinks = true;
    const [lng, lat] = kinkResult.features[0].geometry.coordinates;
    console.error(`Self-intersection detected in "${feature.properties.branch}" territory near [${lng.toFixed(5)}, ${lat.toFixed(5)}] (${kinkResult.features.length} crossing(s) total).`);
  }
}
if (hasKinks) {
  console.error('\nAborting: fix the self-intersecting geometry above before writing output.');
  process.exit(1);
}

const out = turf.featureCollection(outFeatures);
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(out));
console.log(`Wrote ${outFeatures.length} territories to ${path.relative(process.cwd(), OUT_PATH)}`);
for (const f of outFeatures) {
  console.log(`  ${f.properties.branch} -> ${f.properties.realName} (${JSON.stringify(f.geometry).length} bytes)`);
}
