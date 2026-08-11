#!/usr/bin/env node
/**
 * Regenerates the territory polygons drawn on the Workforce & Client Map:
 *   - client/public/data/franchise-territories.geo.json — SUR Group's 10
 *     franchises (the ones with real Branch records/access control in this
 *     app; unchanged output shape/consumer contract).
 *   - client/public/data/other-franchise-territories.geo.json — the other 9
 *     independent Home Instead Scotland franchises, shown on the map purely
 *     as read-only reference context (not real Branch records/tenants).
 *
 * Source of truth for BOTH: scripts/data/all-territory-postcodes.json — a
 * flat { "<sector>": { territory, group } } map for all 19 Scotland
 * franchises, built from scripts/data/all-scotland-franchise-postcodes.json
 * (itself scraped consistently from every franchise's own official
 * homeinstead.co.uk/<slug>/about-us "Areas and postcodes we cover" page).
 * This superseded the older internal SUR spreadsheet
 * (scripts/data/territory-postcodes.json, now unused) once real differences
 * were found versus the live franchise websites (e.g. some Glasgow
 * G31/G32/G33 sectors listed under a different franchise than in the old
 * internal data) — the live franchise website is the more current source of
 * truth since franchise boundaries can be renegotiated over time.
 *
 * There is no free, official UK postcode-sector *polygon* dataset (Royal
 * Mail's real delivery-area boundaries are a commercial product — OS
 * Code-Point with Polygons), and no third-party postcode-territory mapping
 * tool does better than this: every option, paid or free, ends up
 * approximating from postcode *points* since that's all that's publicly
 * available. So instead of guessing sector shapes, this script uses every
 * real, live UNIT postcode inside each franchise's assigned sectors (~120k
 * addresses across all 19 franchises), fetched from the ONS Postcode
 * Directory (the official, free, twice-yearly dataset — NOT the defunct
 * mysociety/parlvid Voronoi mirror, and NOT postcodes.io's autocomplete,
 * which silently mis-resolves single-digit outward codes like "FK1 3" as the
 * unrelated district "FK13" — see below). Cached at
 * scripts/data/territory-unit-postcodes.json, keyed by postal district, as
 * { pcds, lat, long } rows.
 *
 * Method: every unit postcode becomes a 2.5km circle (turf.circle); circles
 * are unioned (dissolved) per franchise, then clipped to the union of only
 * the council areas actually touched by ANY of the 19 franchises' postcodes
 * (scripts/data/territory-served-councils.json — NOT all of Scotland, which
 * would incorrectly extend territories into unserved areas like Highland or
 * the outer islands; this mask is derived automatically below from sector
 * centroids, not hand-maintained). Sub-1km2 fragments left over from the
 * clip are dropped as noise. This "buffer and dissolve" approach was chosen
 * over a full-plane Voronoi tessellation (tried first) because Voronoi cells
 * are bounded by dead-straight perpendicular-bisector lines between just a
 * couple of points, which produced ugly artifacts — e.g. a border spiking
 * straight across the Firth of Forth — and because Voronoi has to assign
 * every scrap of land to *some* territory, which is wrong wherever a
 * franchise has no real address data. Buffering real addresses only draws
 * territory where people actually are.
 *
 * The 2.5km buffer radius was picked empirically: smaller radii (tried
 * 0.6km, 1.2km) leave rural sectors as "swiss cheese" — dozens of
 * disconnected islands around each village, since real address spacing in
 * rural Perthshire/Borders/Argyll sectors is often >1km. 2.5km closes those
 * gaps into one contiguous shape per franchise while still hugging the real
 * settlement pattern far more closely than a coarse per-sector centroid
 * Voronoi cell. Re-tune RADIUS_KM below and re-run if new territories look
 * too fragmented or too blobby.
 *
 * postcodes.io ambiguity gotcha (if the geocoding step is ever re-run):
 * compacting "district + sector digit" (e.g. "FK1 3" -> "FK13") can collide
 * with a real, unrelated outward code. The ONS Postcode Directory avoids
 * this entirely because its `pcds` field keeps the district/sector space,
 * so sectors are parsed unambiguously with a regex instead of a compacted
 * string match.
 *
 * If any franchise supplies an updated postcode list in future:
 *   1. Re-extract scripts/data/all-scotland-franchise-postcodes.json (or
 *      re-scrape the relevant franchise's about-us page) and rebuild
 *      scripts/data/all-territory-postcodes.json (flat sector -> {territory,
 *      group} map; group is "sur" or "independent" per BRANCH_BY_REAL_NAME
 *      membership below).
 *   2. Refresh scripts/data/territory-unit-postcodes.json for any new
 *      postal districts via the ONS Postcode Directory ArcGIS FeatureServer
 *      (services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/
 *      Online_ONS_Postcode_Directory_Live/FeatureServer/1/query), querying
 *      `PCDS LIKE '<district> %'` with outFields pcds,lat,long (paginate via
 *      resultOffset while `exceededTransferLimit` is true).
 *   3. Re-run this script — it derives the served-council mask and both
 *      output files automatically.
 *
 * Run with: node scripts/generate-franchise-territories.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COUNCILS_PATH = path.join(__dirname, 'data', 'scotland-councils.geojson');
const TERRITORY_MAP_PATH = path.join(__dirname, 'data', 'all-territory-postcodes.json');
const UNIT_POSTCODES_PATH = path.join(__dirname, 'data', 'territory-unit-postcodes.json');
const SERVED_COUNCILS_PATH = path.join(__dirname, 'data', 'territory-served-councils.json');
const SUR_OUT_PATH = path.join(__dirname, '..', 'client', 'public', 'data', 'franchise-territories.geo.json');
const OTHER_OUT_PATH = path.join(__dirname, '..', 'client', 'public', 'data', 'other-franchise-territories.geo.json');

const RADIUS_KM = 2.5;
// Circle smoothness: low step counts (e.g. 6) render each buffered postcode
// as a hexagon, so the union of thousands of them looks spiky/faceted along
// every edge instead of a smooth curve — this was the cause of the jagged,
// "dirty" look reported after the first buffer+union pass. 32 gives visually
// round circles; simplify() below then trims the resulting vertex count.
const CIRCLE_STEPS = 32;

// Real franchise/territory name -> internal branch slug (must match
// client/src/data/franchise-real-names.ts). Only SUR Group's 10 franchises
// have real Branch records/access control in this app; the 9 independent
// franchises get a display-only slug (slugified from their name) since
// they're a reference layer, not a real tenant.
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

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const territoryMap = JSON.parse(fs.readFileSync(TERRITORY_MAP_PATH, 'utf8'));
const byDistrict = JSON.parse(fs.readFileSync(UNIT_POSTCODES_PATH, 'utf8'));
const councils = JSON.parse(fs.readFileSync(COUNCILS_PATH, 'utf8'));

// Group every real unit postcode's [lon, lat] by the territory its sector
// belongs to, and separately collect per-sector points to derive the
// coverage mask below.
const pointsByTerritory = {};
const sectorPoints = {};
let assigned = 0, skipped = 0;
for (const rows of Object.values(byDistrict)) {
  for (const row of rows) {
    const m = row.pcds.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?) (\d)/);
    if (!m) { skipped++; continue; }
    const sector = `${m[1]} ${m[2]}`;
    const info = territoryMap[sector];
    if (!info) { skipped++; continue; }
    const lon = parseFloat(row.long), lat = parseFloat(row.lat);
    if (!isFinite(lon) || !isFinite(lat)) { skipped++; continue; }
    (pointsByTerritory[info.territory] ??= []).push([lon, lat]);
    (sectorPoints[sector] ??= []).push([lon, lat]);
    assigned++;
  }
}
console.log(`assigned ${assigned} unit postcodes to territories (${skipped} skipped: outside our 19 franchises' sectors)`);

// Derive the served-council mask automatically from sector centroids (one
// point-in-polygon check per sector, not per unit postcode) instead of
// hand-maintaining the list — this keeps the mask in sync whenever the
// sector list changes.
const servedCouncilNames = new Set();
for (const [sector, pts] of Object.entries(sectorPoints)) {
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const pt = turf.point([lon, lat]);
  for (const f of councils.features) {
    if (turf.booleanPointInPolygon(pt, f.geometry)) {
      servedCouncilNames.add(f.properties.LAD23NM);
      break;
    }
  }
}
fs.writeFileSync(SERVED_COUNCILS_PATH, JSON.stringify([...servedCouncilNames].sort(), null, 1) + '\n');
console.log(`served councils (${servedCouncilNames.size}):`, [...servedCouncilNames].sort().join(', '));

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

// This step (buffer + pairwise-union per territory) is the slow part with
// all 19 franchises' ~120k addresses — slow enough to risk exceeding a
// single shell command's timeout. So progress is cached to disk per
// territory (PROGRESS_PATH) and this script is resumable: re-running it
// picks up only the territories not yet computed. Delete PROGRESS_PATH to
// force a full recompute (e.g. after changing RADIUS_KM or CIRCLE_STEPS).
const PROGRESS_PATH = path.join(__dirname, 'data', '.territory-progress.json');
const progress = fs.existsSync(PROGRESS_PATH) ? JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')) : {};

const territoryNames = Object.keys(pointsByTerritory);
for (const territory of territoryNames) {
  if (progress[territory]) { console.log(`${territory}: already computed, skipping`); continue; }
  const pts = pointsByTerritory[territory];
  const branch = BRANCH_BY_REAL_NAME[territory];
  const isSur = !!branch;
  const circles = pts.map(p => turf.circle(p, RADIUS_KM, { steps: CIRCLE_STEPS, units: 'kilometers' }));
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
  // High circle-step count above already gives smooth curves; simplify just
  // trims redundant vertices from the pairwise-union process (keeps file size
  // sane without re-introducing the low-step-count jaggedness this replaces).
  merged = turf.simplify(merged, { tolerance: 0.0008, highQuality: true, mutate: true });
  merged.properties = isSur
    ? { branch, realName: territory }
    : { slug: slugify(territory), realName: territory, group: 'independent' };
  progress[territory] = merged;
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress));
  console.log(`${territory}: ${pts.length} addresses -> territory polygon built (${isSur ? 'SUR' : 'independent'})`);
}

const remaining = territoryNames.filter(t => !progress[t]);
if (remaining.length > 0) {
  console.log(`${remaining.length} territories still pending: ${remaining.join(', ')} — re-run this script to continue.`);
  process.exit(0);
}

// --- OVERLAP RESOLUTION -----------------------------------------------
// Every territory above is built independently (buffer its own addresses,
// clip to the shared coverage mask), so nothing stops two adjacent
// franchises' buffered shapes from overlapping at a shared border — real
// examples include independent West Dunbartonshire's G15 sectors sitting
// right against SUR's Glasgow North around Drumchapel. Left unresolved,
// that renders as visibly double-claimed ground where two territories'
// fills stack on the map. Resolve it here across ALL 19 territories
// (SUR-vs-SUR, SUR-vs-independent, independent-vs-independent) — not just
// within one group.
//
// A first attempt gave the entire contested overlap to whichever territory
// had the higher TOTAL address count. That's wrong: total count is a
// global stat, not a local one, and it silently deleted real ground from
// smaller-total franchises even in dense Glasgow sectors where their own
// addresses sit inside the shared border zone — the validation pass below
// caught this immediately as a large regression (541/668 sector centroids,
// down from 663/668). Don't reintroduce a single-polygon
// turf.difference(loser, winner) "winner takes the whole overlap" trim.
//
// Instead, split each contested overlap zone using a local Voronoi
// tessellation of the real addresses from BOTH territories near that
// border (not just their totals) — ground closer to territory A's own
// addresses stays with A, ground closer to B's stays with B, exactly the
// same "follow real address density" principle the rest of this script
// already uses. This only touches the small overlap polygon itself; each
// territory's exclusive (non-overlapping) area is untouched.
// Resolved pairs are checkpointed separately (this phase isn't cheap across
// all C(19,2)=171 pairs — dense Glasgow-area pairs can have thousands of
// nearby addresses to Voronoi-split) so a re-run after a timeout resumes
// instead of redoing already-settled pairs.
const RESOLVED_PAIRS_PATH = path.join(__dirname, 'data', '.territory-resolved-pairs.json');
const resolvedPairs = new Set(
  fs.existsSync(RESOLVED_PAIRS_PATH) ? JSON.parse(fs.readFileSync(RESOLVED_PAIRS_PATH, 'utf8')) : []
);
const MIN_OVERLAP_KM2 = 0.05; // slivers below this are visually meaningless — skip the expensive split
const MAX_CANDIDATES_PER_SIDE = 1500; // caps Voronoi/union cost in dense urban clusters

let overlapsResolved = 0;
for (let i = 0; i < territoryNames.length; i++) {
  for (let j = i + 1; j < territoryNames.length; j++) {
    const nameA = territoryNames[i];
    const nameB = territoryNames[j];
    const pairKey = [nameA, nameB].sort().join('|');
    if (resolvedPairs.has(pairKey)) continue;

    const a = progress[nameA];
    const b = progress[nameB];
    // Cheap bbox-overlap pre-check before the more expensive exact boolean
    // check — most of the 171 pairs are territories nowhere near each other.
    const [aMinX, aMinY, aMaxX, aMaxY] = turf.bbox(a);
    const [bMinX, bMinY, bMaxX, bMaxY] = turf.bbox(b);
    const bboxOverlaps = aMinX <= bMaxX && bMinX <= aMaxX && aMinY <= bMaxY && bMinY <= aMaxY;
    if (!bboxOverlaps) { resolvedPairs.add(pairKey); continue; }

    let overlapPoly = null;
    try {
      if (turf.booleanOverlap(a, b)) overlapPoly = turf.intersect(turf.featureCollection([a, b]));
    } catch (e) {
      console.warn(`overlap check failed for ${nameA} vs ${nameB}:`, e.message);
    }
    if (!overlapPoly || turf.area(overlapPoly) / 1e6 < MIN_OVERLAP_KM2) {
      resolvedPairs.add(pairKey);
      continue;
    }

    const t0 = Date.now();
    const [minX, minY, maxX, maxY] = turf.bbox(overlapPoly);
    const padDeg = 0.03; // ~3km — pulls in nearby addresses on both sides of the border, not just inside the sliver
    const paddedBbox = [minX - padDeg, minY - padDeg, maxX + padDeg, maxY + padDeg];
    const inBbox = (p) => p[0] >= paddedBbox[0] && p[0] <= paddedBbox[2] && p[1] >= paddedBbox[1] && p[1] <= paddedBbox[3];
    // Even sampling (stride) keeps spatial spread when a side has more
    // candidates than the cap, rather than biasing toward one area.
    const sample = (arr) => {
      const filtered = arr.filter(inBbox);
      if (filtered.length <= MAX_CANDIDATES_PER_SIDE) return filtered;
      const stride = filtered.length / MAX_CANDIDATES_PER_SIDE;
      const out = [];
      for (let k = 0; k < MAX_CANDIDATES_PER_SIDE; k++) out.push(filtered[Math.floor(k * stride)]);
      return out;
    };
    const candidatePoints = [
      ...sample(pointsByTerritory[nameA]).map(p => turf.point(p, { owner: 'A' })),
      ...sample(pointsByTerritory[nameB]).map(p => turf.point(p, { owner: 'B' })),
    ];
    if (candidatePoints.length < 2) { resolvedPairs.add(pairKey); continue; } // not enough local evidence to split — leave both as-is

    let ownerAPoly = null, ownerBPoly = null;
    try {
      const cells = turf.voronoi(turf.featureCollection(candidatePoints), { bbox: paddedBbox });
      const aCells = [], bCells = [];
      cells.features.forEach((cell, idx) => {
        if (!cell) return;
        (candidatePoints[idx].properties.owner === 'A' ? aCells : bCells).push(cell);
      });
      if (aCells.length) ownerAPoly = await reduceUnion(aCells);
      if (bCells.length) ownerBPoly = await reduceUnion(bCells);
    } catch (e) {
      console.warn(`voronoi split failed for ${nameA} vs ${nameB}, leaving both as-is:`, e.message);
      resolvedPairs.add(pairKey);
      fs.writeFileSync(RESOLVED_PAIRS_PATH, JSON.stringify([...resolvedPairs]));
      continue;
    }
    if (!ownerAPoly || !ownerBPoly) { resolvedPairs.add(pairKey); continue; }

    try {
      const aShare = turf.intersect(turf.featureCollection([ownerAPoly, overlapPoly]));
      const bShare = turf.intersect(turf.featureCollection([ownerBPoly, overlapPoly]));
      const aExclusive = turf.difference(turf.featureCollection([a, b])) ?? a;
      const bExclusive = turf.difference(turf.featureCollection([b, a])) ?? b;
      const newA = aShare ? (turf.union(turf.featureCollection([aExclusive, aShare])) ?? aExclusive) : aExclusive;
      const newB = bShare ? (turf.union(turf.featureCollection([bExclusive, bShare])) ?? bExclusive) : bExclusive;
      newA.properties = a.properties;
      newB.properties = b.properties;
      progress[nameA] = newA;
      progress[nameB] = newB;
      overlapsResolved++;
      console.log(`overlap resolved: ${nameA} vs ${nameB} split by local address density (${candidatePoints.length} nearby addresses, ${Date.now() - t0}ms)`);
    } catch (e) {
      console.warn(`overlap split-apply failed for ${nameA} vs ${nameB}, leaving both as-is:`, e.message);
    }
    resolvedPairs.add(pairKey);
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress));
    fs.writeFileSync(RESOLVED_PAIRS_PATH, JSON.stringify([...resolvedPairs]));
  }
}
console.log(`overlap resolution: ${overlapsResolved} contested pair(s) split by local address density`);

// Drop any sliver fragments the trimming above may have introduced, then
// recompute each feature's centroid (used by the map to place a permanent
// name label — see below — inside the actual shape rather than at a
// bounding-box center that can land outside an odd-shaped or multi-part
// polygon).
for (const territory of territoryNames) {
  let f = progress[territory];
  if (f.geometry.type === 'MultiPolygon') {
    f.geometry.coordinates = f.geometry.coordinates.filter(
      c => turf.area(turf.polygon(c)) / 1e6 >= 1
    );
  }
  const centroid = turf.pointOnFeature(f).geometry.coordinates;
  f.properties = { ...f.properties, centroid };
  progress[territory] = f;
}

// --- VALIDATION ----------------------------------------------------------
// Sector-centroid-in-polygon spot check, run automatically on every
// regeneration (not just as a one-off manual script) so a bad
// coverage-mask edit or an over-aggressive overlap trim shows up
// immediately instead of silently shipping. Do not drop this pass either.
let checked = 0, mismatches = 0;
for (const [sector, pts] of Object.entries(sectorPoints)) {
  const info = territoryMap[sector];
  if (!info) continue;
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const pt = turf.point([lon, lat]);
  const territoryFeature = progress[info.territory];
  checked++;
  if (!territoryFeature || !turf.booleanPointInPolygon(pt, territoryFeature.geometry)) {
    mismatches++;
    console.log(`MISMATCH: sector ${sector} centroid does not fall inside its assigned territory "${info.territory}"`);
  }
}
console.log(`validation: ${checked - mismatches}/${checked} sector centroids fall inside their assigned territory`);

const surFeatures = [];
const otherFeatures = [];
for (const territory of territoryNames) {
  const f = progress[territory];
  (f.properties.branch ? surFeatures : otherFeatures).push(f);
}

fs.writeFileSync(SUR_OUT_PATH, JSON.stringify(turf.featureCollection(surFeatures)));
console.log(`Wrote ${surFeatures.length} SUR Group territory features to ${path.relative(process.cwd(), SUR_OUT_PATH)}`);

fs.writeFileSync(OTHER_OUT_PATH, JSON.stringify(turf.featureCollection(otherFeatures)));
console.log(`Wrote ${otherFeatures.length} independent-franchise territory features to ${path.relative(process.cwd(), OTHER_OUT_PATH)}`);

fs.rmSync(PROGRESS_PATH, { force: true });
fs.rmSync(RESOLVED_PAIRS_PATH, { force: true });
