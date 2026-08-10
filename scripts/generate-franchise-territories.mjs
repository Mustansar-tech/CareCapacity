#!/usr/bin/env node
/**
 * Regenerates client/public/data/franchise-territories.geo.json — the territory
 * polygons drawn on the Workforce & Client Map for each Scottish franchise.
 *
 * Source of truth: scripts/data/territory-postcodes.json, extracted from the
 * franchise-supplied "Territory Postcodes" spreadsheet (one sheet per
 * franchise, each row a postcode sector + area name). Each sector has a
 * precise centroid cached in scripts/data/territory-sector-centroids.json
 * (geocoded via postcodes.io by outward-code, or by exact sector where a
 * single outward code is split across two franchises; a handful of sectors
 * with too few live postcodes to geocode reliably were located by place name
 * via Nominatim instead — see git history for the one-off geocoding scripts).
 *
 * Method: every sector centroid becomes a point in a Voronoi tessellation
 * (turf.voronoi), so every location is assigned to the territory of its
 * nearest known postcode sector. Cells are clipped to the union of only the
 * council areas actually touched by at least one franchise's postcodes
 * (scripts/data/territory-served-councils.json, derived from the postcode
 * data — see the "touched councils" check in git history) — NOT all of
 * Scotland. Clipping to all of Scotland was tried first and was wrong: with
 * only 10 points to partition the whole country, Voronoi cells ballooned
 * into Highland, Argyll & Bute, Dumfries & Galloway and the islands, none of
 * which any franchise serves. Cells are then unioned (dissolved) per
 * franchise. This reproduces the spreadsheet's actual assignments almost
 * exactly (359/360 sectors validated) — far more accurately than the
 * earlier whole-council-area approximation, and it automatically covers
 * areas like Aberdeenshire that a pure per-franchise-council approach
 * missed (Aberdeen franchise's postcodes reach into Aberdeenshire towns).
 *
 * If Sur Group supplies an updated postcode spreadsheet in future, re-extract
 * it into territory-postcodes.json (see the parsing logic used originally —
 * one sheet per franchise, first postcode-shaped cell in each row + the next
 * cell as the area name) and re-run the geocoding step for any new sectors
 * before re-running this script.
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
const CENTROIDS_PATH = path.join(__dirname, 'data', 'territory-sector-centroids.json');
const SERVED_COUNCILS_PATH = path.join(__dirname, 'data', 'territory-served-councils.json');
const OUT_PATH = path.join(__dirname, '..', 'client', 'public', 'data', 'franchise-territories.geo.json');

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
const centroids = JSON.parse(fs.readFileSync(CENTROIDS_PATH, 'utf8'));
const councils = JSON.parse(fs.readFileSync(COUNCILS_PATH, 'utf8'));
const servedCouncilNames = new Set(JSON.parse(fs.readFileSync(SERVED_COUNCILS_PATH, 'utf8')));

const sectors = Object.keys(territoryMap);
const missing = sectors.filter(s => !centroids[s]);
if (missing.length > 0) {
  throw new Error(`Missing geocoded centroid for sectors: ${missing.join(', ')}. Re-run the geocoding step before regenerating.`);
}

const points = turf.featureCollection(sectors.map(s =>
  turf.point(centroids[s], { sector: s, territory: territoryMap[s].territory })
));
console.log('territory postcode sectors:', points.features.length);

// Coverage mask = union of ONLY the council areas actually touched by a
// franchise postcode (not all of Scotland — see file header comment).
let coverageMask = null;
for (const f of councils.features) {
  if (!servedCouncilNames.has(f.properties.LAD23NM)) continue;
  const feat = turf.feature(f.geometry);
  coverageMask = coverageMask ? turf.union(turf.featureCollection([coverageMask, feat])) : feat;
}
if (!coverageMask) throw new Error('No served councils matched scotland-councils.geojson — check territory-served-councils.json names.');

const bbox = turf.bbox(coverageMask);
const pad = 0.5;
const voronoiBbox = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad];

const voronoiPolys = turf.voronoi(points, { bbox: voronoiBbox });
console.log('voronoi cells:', voronoiPolys.features.length);

const cellsByTerritory = {};
for (let i = 0; i < voronoiPolys.features.length; i++) {
  const cell = voronoiPolys.features[i];
  if (!cell) continue;
  const territory = points.features[i].properties.territory;
  let clipped;
  try {
    clipped = turf.intersect(turf.featureCollection([cell, coverageMask]));
  } catch (e) {
    console.warn(`intersect failed for sector ${points.features[i].properties.sector}: ${e.message}`);
    continue;
  }
  if (!clipped) continue;
  (cellsByTerritory[territory] ??= []).push(clipped);
}

const outFeatures = [];
for (const [territory, cells] of Object.entries(cellsByTerritory)) {
  let acc = cells[0];
  for (let i = 1; i < cells.length; i++) {
    try {
      acc = turf.union(turf.featureCollection([acc, cells[i]]));
    } catch (e) {
      console.warn(`union failed while dissolving ${territory}: ${e.message}`);
    }
  }
  const branch = BRANCH_BY_REAL_NAME[territory];
  if (!branch) {
    console.warn(`No branch slug mapped for territory "${territory}" — skipping.`);
    continue;
  }
  acc.properties = { branch, realName: territory };
  outFeatures.push(acc);
}

fs.writeFileSync(OUT_PATH, JSON.stringify(turf.featureCollection(outFeatures)));
console.log(`Wrote ${outFeatures.length} territory features to ${path.relative(process.cwd(), OUT_PATH)}`);
