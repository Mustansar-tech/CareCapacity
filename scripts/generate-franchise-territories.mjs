#!/usr/bin/env node
/**
 * Regenerates client/public/data/franchise-territories.geo.json — the territory
 * polygons drawn on the Workforce & Client Map for each Scottish franchise.
 *
 * Source of truth: scripts/data/territory-postcodes.json, extracted from the
 * franchise-supplied "Territory Postcodes" spreadsheet (one sheet per
 * franchise, each row a postcode sector + area name).
 *
 * There is no free, official UK postcode-sector *polygon* dataset (Royal
 * Mail's real delivery-area boundaries are a commercial product — OS
 * Code-Point with Polygons). So instead of guessing sector shapes, this
 * script uses every real, live UNIT postcode inside each of our 360
 * assigned sectors (~65k addresses across the served council areas),
 * fetched from the ONS Postcode Directory (the official, free, twice-yearly
 * dataset — NOT the defunct mysociety/parlvid Voronoi mirror, and NOT
 * postcodes.io's autocomplete, which silently mis-resolves single-digit
 * outward codes like "FK1 3" as the unrelated district "FK13" — see below).
 * Cached at scripts/data/territory-unit-postcodes.json, keyed by postal
 * district, as { pcds, lat, long } rows.
 *
 * Method: every unit postcode becomes a 2.5km circle (turf.circle); circles
 * are unioned (dissolved) per franchise, then clipped to the union of only
 * the council areas actually touched by a franchise's postcodes
 * (scripts/data/territory-served-councils.json — NOT all of Scotland, which
 * would incorrectly extend territories into unserved areas like Highland or
 * the islands). Sub-1km2 fragments left over from the clip are dropped as
 * noise. This "buffer and dissolve" approach was chosen over a full-plane
 * Voronoi tessellation (tried first) because Voronoi cells are bounded by
 * dead-straight perpendicular-bisector lines between just a couple of
 * points, which produced ugly artifacts — e.g. a border spiking straight
 * across the Firth of Forth — and because Voronoi has to assign every scrap
 * of land to *some* territory, which is wrong wherever a franchise has no
 * real address data. Buffering real addresses only draws territory where
 * people actually are.
 *
 * The 2.5km buffer radius was picked empirically: smaller radii (tried
 * 0.6km, 1.2km) leave rural sectors as "swiss cheese" — dozens of
 * disconnected islands around each village, since real address spacing in
 * rural Perthshire/Borders sectors is often >1km. 2.5km closes those gaps
 * into one contiguous shape per franchise while still hugging the real
 * settlement pattern far more closely than a coarse per-sector centroid
 * Voronoi cell. Re-tune RADIUS_KM below and re-run if new territories look
 * too fragmented or too blobby.
 *
 * Validated against the source spreadsheet: 358/360 postcode sectors'
 * centroids fall inside their correct franchise polygon (the other 2 are
 * genuine coastal/border edge cases, e.g. Coldstream right on the England
 * border).
 *
 * postcodes.io ambiguity gotcha (if the geocoding step is ever re-run):
 * compacting "district + sector digit" (e.g. "FK1 3" -> "FK13") can collide
 * with a real, unrelated outward code. The ONS Postcode Directory avoids
 * this entirely because its `pcds` field keeps the district/sector space,
 * so sectors are parsed unambiguously with a regex instead of a compacted
 * string match.
 *
 * If Sur Group supplies an updated postcode spreadsheet in future:
 *   1. Re-extract scripts/data/territory-postcodes.json (one sheet per
 *      franchise; first postcode-shaped cell + next cell as area name).
 *   2. Re-derive scripts/data/territory-served-councils.json (union of
 *      council areas containing at least one sector centroid).
 *   3. Refresh scripts/data/territory-unit-postcodes.json for any new
 *      postal districts via the ONS Postcode Directory ArcGIS FeatureServer
 *      (services1.arcgis.com/ESMARspQHYMw9BZ9/.../ONS_Postcode_Directory_*),
 *      querying `pcds LIKE '<district> %' AND doterm IS NULL`.
 *   4. Re-run this script.
 *
 * Run with: node scripts/generate-franchise-territories.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COUNCILS_PATH = path.join(__dirname, 'data', 'scotland-councils.geojson');
const POSTCODES_PATH = path.join(__dirname, 'data', 'territory-postcodes.json');
const UNIT_POSTCODES_PATH = path.join(__dirname, 'data', 'territory-unit-postcodes.json');
const SERVED_COUNCILS_PATH = path.join(__dirname, 'data', 'territory-served-councils.json');
const OUT_PATH = path.join(__dirname, '..', 'client', 'public', 'data', 'franchise-territories.geo.json');

const RADIUS_KM = 2.5;

// Real franchise/territory name -> internal branch slug (must match
// client/src/data/franchise-real-names.ts).
const BRANCH_BY_REAL_NAME = {
  'Aberdeen': 'aberdeen',
  'South Ayrshire and Kilmarnock': 'south-ayrshire',
  'East Lothian and Midlothian': 'east-lothian',
  'Glasgow North': 'glasgow-north',
  'Glasgow South': 'glasgow-south',
  'North Lanarkshire and Glasgow East': 'north-lanarkshire',
  'Perthshire': 'perthshire',
  'Scottish Borders': 'scottish-borders',
  'Stirling and Falkirk': 'stirling-falkirk',
  'West Fife and Kinross': 'west-fife-kinross',
};

const territoryMap = JSON.parse(fs.readFileSync(POSTCODES_PATH, 'utf8'));
const byDistrict = JSON.parse(fs.readFileSync(UNIT_POSTCODES_PATH, 'utf8'));
const councils = JSON.parse(fs.readFileSync(COUNCILS_PATH, 'utf8'));
const servedCouncilNames = new Set(JSON.parse(fs.readFileSync(SERVED_COUNCILS_PATH, 'utf8')));

// Group every real unit postcode's [lon, lat] by the territory its sector belongs to.
const pointsByTerritory = {};
let assigned = 0, skipped = 0;
for (const rows of Object.values(byDistrict)) {
  for (const row of rows) {
    const m = row.pcds.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?) (\d)/);
    if (!m) { skipped++; continue; }
    const info = territoryMap[`${m[1]} ${m[2]}`];
    if (!info) { skipped++; continue; }
    const lon = parseFloat(row.long), lat = parseFloat(row.lat);
    if (!isFinite(lon) || !isFinite(lat)) { skipped++; continue; }
    (pointsByTerritory[info.territory] ??= []).push([lon, lat]);
    assigned++;
  }
}
console.log(`assigned ${assigned} unit postcodes to territories (${skipped} skipped: outside our 360 sectors)`);

// Coverage mask = union of ONLY the council areas actually touched by a
// franchise postcode (not all of Scotland).
let coverageMask = null;
for (const f of councils.features) {
  if (!servedCouncilNames.has(f.properties.LAD23NM)) continue;
  const feat = turf.feature(f.geometry);
  coverageMask = coverageMask ? turf.union(turf.featureCollection([coverageMask, feat])) : feat;
}
if (!coverageMask) throw new Error('No served councils matched scotland-councils.geojson — check territory-served-councils.json names.');

// Balanced pairwise union keeps merge complexity from snowballing the way a
// naive left-fold accumulation would with thousands of circles.
async function reduceUnion(polys) {
  let layer = polys;
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        try {
          next.push(turf.union(turf.featureCollection([layer[i], layer[i + 1]])));
        } catch (e) {
          console.warn('union pair failed, keeping one side:', e.message);
          next.push(layer[i]);
        }
      } else {
        next.push(layer[i]);
      }
    }
    layer = next;
  }
  return layer[0];
}

const outFeatures = [];
for (const [territory, pts] of Object.entries(pointsByTerritory)) {
  const branch = BRANCH_BY_REAL_NAME[territory];
  if (!branch) {
    console.warn(`No branch slug mapped for territory "${territory}" — skipping.`);
    continue;
  }
  const circles = pts.map(p => turf.circle(p, RADIUS_KM, { steps: 6, units: 'kilometers' }));
  let merged = await reduceUnion(circles);
  try {
    const clipped = turf.intersect(turf.featureCollection([merged, coverageMask]));
    if (clipped) merged = clipped;
  } catch (e) {
    console.warn(territory, 'coverage-mask clip failed, using unclipped shape:', e.message);
  }
  if (merged.geometry.type === 'MultiPolygon') {
    merged.geometry.coordinates = merged.geometry.coordinates.filter(
      c => turf.area(turf.polygon(c)) / 1e6 >= 1
    );
  }
  merged.properties = { branch, realName: territory };
  outFeatures.push(merged);
  console.log(`${territory}: ${pts.length} addresses -> territory polygon built`);
}

fs.writeFileSync(OUT_PATH, JSON.stringify(turf.featureCollection(outFeatures)));
console.log(`Wrote ${outFeatures.length} territory features to ${path.relative(process.cwd(), OUT_PATH)}`);
