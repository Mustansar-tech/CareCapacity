#!/usr/bin/env node
/**
 * verify_postcodes_vs_territories.mjs
 * ---------------------------------------------------------------------
 * The definitive "postcodes vs visual territory" check.
 *
 * For every postcode sector in the source-of-truth data
 * (scripts/data/all-territory-postcodes.json), this script:
 *   1. Looks up that sector's REAL unit-postcode addresses (from
 *      scripts/data/territory-unit-postcodes.json).
 *   2. Computes that sector's real-address centroid.
 *   3. Checks whether that centroid falls inside the territory polygon
 *      it's SUPPOSED to belong to (from the rendered
 *      franchise-territories.geo.json / other-franchise-territories.geo.json
 *      files -- i.e. what's ACTUALLY drawn on the map).
 *   4. Reports PASS/FAIL per sector, plus which OTHER territory (if any)
 *      the point actually landed in when it fails.
 *
 * This is the single most important check in the whole pipeline: it
 * directly answers "is the map visually showing postcodes in the right
 * place" rather than checking styling, overlaps, or geometry validity in
 * isolation.
 *
 * Run from your project root (where scripts/ and client/ exist):
 *   node scripts/verify_postcodes_vs_territories.mjs
 *
 * Optional: check specific postcodes only
 *   node scripts/verify_postcodes_vs_territories.mjs "G41 1" "AB10 1" "TD1 3"
 *
 * Output:
 *   - Console summary (pass rate per territory)
 *   - postcode_verification_report.csv (every sector, PASS/FAIL, detail)
 *   - postcode_verification_report.json (same, machine-readable)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const TERRITORY_MAP_PATH = path.join(ROOT, 'scripts', 'data', 'all-territory-postcodes.json');
const UNIT_POSTCODES_PATH = path.join(ROOT, 'scripts', 'data', 'territory-unit-postcodes.json');
const SUR_GEOJSON_PATH = path.join(ROOT, 'client', 'public', 'data', 'franchise-territories.geo.json');
const OTHER_GEOJSON_PATH = path.join(ROOT, 'client', 'public', 'data', 'other-franchise-territories.geo.json');

const OUT_CSV = path.join(ROOT, 'postcode_verification_report.csv');
const OUT_JSON = path.join(ROOT, 'postcode_verification_report.json');

function loadJson(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`ERROR: ${label} not found at ${p}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const territoryMap = loadJson(TERRITORY_MAP_PATH, 'all-territory-postcodes.json');
const byDistrict = loadJson(UNIT_POSTCODES_PATH, 'territory-unit-postcodes.json');
const surGeo = loadJson(SUR_GEOJSON_PATH, 'franchise-territories.geo.json');
const otherGeo = loadJson(OTHER_GEOJSON_PATH, 'other-franchise-territories.geo.json');

const allTerritoryFeatures = [...surGeo.features, ...otherGeo.features];
const polygonByRealName = Object.fromEntries(
  allTerritoryFeatures.map(f => [f.properties.realName, f])
);

// Optional CLI filter: node verify.mjs "G41 1" "AB10 1" ...
const cliArgs = process.argv.slice(2);
let filterSectors = null;
if (cliArgs.length > 0) {
  // Args come in pairs like "G41" "1" from shell quoting quirks, but we
  // also support "G41 1" as a single quoted arg -- normalise both.
  const joined = cliArgs.join(' ');
  filterSectors = new Set(
    joined.split(/,|\s{2,}/).map(s => s.trim()).filter(Boolean)
  );
  // Fallback: if user passed unquoted pairs, try to re-pair them.
  if ([...filterSectors].every(s => !/\s/.test(s)) && cliArgs.length % 2 === 0) {
    filterSectors = new Set();
    for (let i = 0; i < cliArgs.length; i += 2) {
      filterSectors.add(`${cliArgs[i]} ${cliArgs[i + 1]}`);
    }
  }
}

// Build sector -> real address points, from the cached unit-postcode data.
const pointsBySector = {};
for (const rows of Object.values(byDistrict)) {
  for (const row of rows) {
    const m = row.pcds.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?) (\d)/);
    if (!m) continue;
    const sector = `${m[1]} ${m[2]}`;
    const lon = parseFloat(row.long), lat = parseFloat(row.lat);
    if (!isFinite(lon) || !isFinite(lat)) continue;
    (pointsBySector[sector] ??= []).push([lon, lat]);
  }
}

const results = [];
const sectorsToCheck = filterSectors
  ? [...filterSectors].filter(s => territoryMap[s])
  : Object.keys(territoryMap);

if (filterSectors) {
  const notFound = [...filterSectors].filter(s => !territoryMap[s]);
  if (notFound.length) {
    console.warn(`Warning: these sectors aren't in all-territory-postcodes.json and will be skipped: ${notFound.join(', ')}`);
  }
}

console.log(`Checking ${sectorsToCheck.length} postcode sector(s)...\n`);

for (const sector of sectorsToCheck) {
  const info = territoryMap[sector];
  const expectedTerritory = info.territory;
  const expectedPolygon = polygonByRealName[expectedTerritory];

  const pts = pointsBySector[sector];
  if (!pts || pts.length === 0) {
    results.push({
      sector, expectedTerritory, status: 'NO_DATA',
      detail: 'No real address data found for this sector in territory-unit-postcodes.json',
      addressCount: 0,
    });
    continue;
  }

  const centroid = turf.centroid(turf.multiPoint(pts)).geometry.coordinates;
  const centroidPt = turf.point(centroid);

  if (!expectedPolygon) {
    results.push({
      sector, expectedTerritory, status: 'NO_POLYGON',
      detail: `Territory "${expectedTerritory}" has no polygon in the rendered GeoJSON files`,
      addressCount: pts.length,
    });
    continue;
  }

  const insideExpected = turf.booleanPointInPolygon(centroidPt, expectedPolygon);

  if (insideExpected) {
    results.push({
      sector, expectedTerritory, status: 'PASS',
      detail: '', addressCount: pts.length,
    });
  } else {
    let actualTerritory = null;
    for (const feat of allTerritoryFeatures) {
      if (feat.properties.realName === expectedTerritory) continue;
      if (turf.booleanPointInPolygon(centroidPt, feat)) {
        actualTerritory = feat.properties.realName;
        break;
      }
    }
    results.push({
      sector, expectedTerritory, status: 'FAIL',
      detail: actualTerritory
        ? `Centroid actually falls inside "${actualTerritory}" instead`
        : 'Centroid falls outside ALL territory polygons (likely clipped by coverage mask)',
      addressCount: pts.length,
      actualTerritory: actualTerritory || null,
    });
  }
}

// ---------------------------------------------------------------------
// Console summary, grouped by territory
// ---------------------------------------------------------------------
const byTerritory = {};
for (const r of results) {
  (byTerritory[r.expectedTerritory] ??= []).push(r);
}

console.log('='.repeat(72));
console.log('SUMMARY BY TERRITORY');
console.log('='.repeat(72));
let totalPass = 0, totalFail = 0, totalOther = 0;
for (const [territory, rows] of Object.entries(byTerritory).sort()) {
  const pass = rows.filter(r => r.status === 'PASS').length;
  const fail = rows.filter(r => r.status === 'FAIL').length;
  const other = rows.filter(r => r.status !== 'PASS' && r.status !== 'FAIL').length;
  totalPass += pass; totalFail += fail; totalOther += other;
  const pct = rows.length ? ((pass / rows.length) * 100).toFixed(1) : '0.0';
  const flag = fail > 0 ? '  \u26a0 FAILURES' : '';
  console.log(`${territory.padEnd(45)} ${String(pass).padStart(3)}/${String(rows.length).padEnd(3)} passed (${pct}%)${flag}`);
}
console.log('-'.repeat(72));
console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed, ${totalOther} other (no data/no polygon)`);
console.log('='.repeat(72));

if (totalFail > 0) {
  console.log('\nFAILURES IN DETAIL:');
  for (const r of results.filter(r => r.status === 'FAIL')) {
    console.log(`  ${r.sector} (expected: ${r.expectedTerritory}) -- ${r.detail} [${r.addressCount} addresses]`);
  }
}

// ---------------------------------------------------------------------
// Write CSV + JSON reports
// ---------------------------------------------------------------------
const csvHeader = 'sector,expectedTerritory,status,addressCount,detail\n';
const csvRows = results.map(r =>
  [r.sector, r.expectedTerritory, r.status, r.addressCount, `"${(r.detail || '').replace(/"/g, '""')}"`].join(',')
).join('\n');
fs.writeFileSync(OUT_CSV, csvHeader + csvRows + '\n');
fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));

console.log(`\nFull report written to:\n  ${path.relative(process.cwd(), OUT_CSV)}\n  ${path.relative(process.cwd(), OUT_JSON)}`);

if (totalFail > 0) {
  process.exitCode = 1; // non-zero exit so this can be used as a CI gate
}
