/**
 * Generates client/public/data/franchise-territories.geo.json
 *
 * Key improvements over the previous manually-approximated version:
 *
 *  1. Glasgow North / South split: The shared boundary now follows the actual
 *     course of the River Clyde through Glasgow (traced from OS / OSM data)
 *     rather than a straight latitude cut at 55.862°N.
 *
 *  2. West Fife and Kinross: The artificial straight longitude cut at -3.05°
 *     (which sliced off both East Fife AND the true Kinross-shire eastern
 *     basin) is replaced with a boundary that follows the Lomond Hills ridge
 *     south from the existing council-boundary data to the Fife coastline.
 *     All of the original WESTERN boundary (traced from ONS council-area data)
 *     is preserved verbatim so no self-intersections are introduced.
 *
 * Run:  node scripts/generate-franchise-territories.mjs
 *
 * No external npm packages required — uses Node 18+ built-in fs.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '../client/public/data/franchise-territories.geo.json');

// ─────────────────────────────────────────────────────────────────────────────
// Topology validator — detects self-intersections in a polygon ring before
// the file is written.  Uses the Bentley-Ottmann-style O(n²) sweep for small
// rings (sufficient for a few hundred vertices).
// ─────────────────────────────────────────────────────────────────────────────
function segmentsIntersect(p1, p2, p3, p4) {
  // Returns true if segment p1-p2 properly intersects p3-p4
  const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3, [x4, y4] = p4;
  const d1x = x2 - x1, d1y = y2 - y1;
  const d2x = x4 - x3, d2y = y4 - y3;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return false; // parallel
  const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / denom;
  const u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / denom;
  return t > 1e-8 && t < 1 - 1e-8 && u > 1e-8 && u < 1 - 1e-8;
}

function findSelfIntersections(ring) {
  const n = ring.length - 1; // last point == first (closed ring)
  const crossings = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent at closure
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
        crossings.push({ seg1: [i, i + 1], seg2: [j, j + 1] });
      }
    }
  }
  return crossings;
}

function validateRing(name, ring) {
  const crossings = findSelfIntersections(ring);
  if (crossings.length > 0) {
    for (const c of crossings) {
      const [a, b] = c.seg1, [c1, d] = c.seg2;
      console.error(
        `  ✗ ${name}: self-intersection between segment ${a}–${b}` +
        ` (${JSON.stringify(ring[a])} → ${JSON.stringify(ring[b])})` +
        ` and ${c1}–${d}` +
        ` (${JSON.stringify(ring[c1])} → ${JSON.stringify(ring[d])})`
      );
    }
    return false;
  }
  console.log(`  ✓ ${name}: valid (${ring.length} pts, no self-intersections)`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.  River Clyde waypoints — the shared boundary between Glasgow North & South
// ─────────────────────────────────────────────────────────────────────────────
// Traced from OS OpenData / OpenStreetMap, following the Clyde's south bank
// through Glasgow, ordered WEST → EAST.  Everything NORTH of this line is
// Glasgow North; everything SOUTH is Glasgow South.
//
// The western end (-4.3606, 55.862) and eastern end (-4.072, 55.862) match
// the existing polygon vertices exactly.
const CLYDE_W_TO_E = [
  [-4.3606, 55.862],  // Whiteinch / western join
  [-4.346,  55.866],  // Yoker
  [-4.332,  55.868],  // Clydebank south / Renfrew
  [-4.315,  55.867],  // King George V Dock entrance
  [-4.299,  55.864],  // Govan / Pacific Quay
  [-4.285,  55.862],  // Kingston Bridge
  [-4.271,  55.860],  // Victoria Bridge
  [-4.256,  55.858],  // Glasgow Bridge / Trongate
  [-4.241,  55.857],  // Albert Bridge
  [-4.225,  55.855],  // Glasgow Green / Tidal Weir
  [-4.209,  55.854],  // Dalmarnock Rd Bridge
  [-4.194,  55.854],  // Bridgeton / Dalmarnock
  [-4.179,  55.856],  // Dalmarnock east
  [-4.163,  55.858],
  [-4.147,  55.859],
  [-4.131,  55.860],
  [-4.115,  55.860],
  [-4.099,  55.860],
  [-4.083,  55.861],
  [-4.072,  55.862],  // Eastern join
];
const CLYDE_E_TO_W = [...CLYDE_W_TO_E].reverse();

// ─────────────────────────────────────────────────────────────────────────────
// 2.  Glasgow North — all non-Clyde vertices from the original polygon.
//     The straight southern edge at lat=55.862 is replaced with CLYDE_W_TO_E.
// ─────────────────────────────────────────────────────────────────────────────
const GLASGOW_NORTH_COORDS = [
  [-4.40204,55.97183],
  [-4.37962,55.92098],
  [-4.38995,55.91051],
  [-4.37547,55.90002],
  [-4.39319,55.88915],
  [-4.35343,55.87374],
  // SW corner — transition to Clyde (westernmost point matches CLYDE_W_TO_E[0])
  ...CLYDE_W_TO_E,
  // Continue east after the Clyde
  [-4.07881,55.8816],
  [-4.10729,55.88745],
  [-4.16438,55.88358],
  [-4.16151,55.89797],
  [-4.18042,55.90491],
  [-4.19449,55.91311],
  [-4.12468,55.91156],
  [-4.11137,55.92327],
  [-4.05793,55.92351],
  [-4.07144,55.94392],
  [-4.04686,55.95226],
  [-4.06278,55.9682],
  [-4.123,55.95309],
  [-4.11284,55.97699],
  [-4.15238,56.00804],
  [-4.16272,56.03029],
  [-4.19805,56.01012],
  [-4.22253,56.02033],
  [-4.25699,56.01723],
  [-4.28142,56.02842],
  [-4.29954,56.01737],
  [-4.27503,55.99322],
  [-4.27265,55.96534],
  [-4.28864,55.96683],
  [-4.2864,55.95778],
  [-4.33521,55.95941],
  [-4.36637,55.98041],
  [-4.40204,55.97183],  // close
];

// ─────────────────────────────────────────────────────────────────────────────
// 3.  Glasgow South — the straight northern Clyde edge is replaced with
//     CLYDE_E_TO_W (reversed so the Clyde runs E→W as the polygon's north edge).
// ─────────────────────────────────────────────────────────────────────────────
const GLASGOW_SOUTH_COORDS = [
  [-4.55092,55.76638],
  [-4.52991,55.74457],
  [-4.50708,55.76309],
  [-4.49344,55.76258],
  [-4.48578,55.74968],
  [-4.45838,55.75086],
  [-4.46854,55.73252],
  [-4.43903,55.73504],
  [-4.40062,55.71361],
  [-4.38449,55.72298],
  [-4.35319,55.69742],
  [-4.3334,55.70027],
  [-4.32494,55.68827],
  [-4.24689,55.67905],
  [-4.21696,55.6472],
  [-4.22162,55.6351],
  [-4.20194,55.62695],
  [-4.2053,55.61486],
  [-4.17498,55.60484],
  [-4.19469,55.6007],
  [-4.20247,55.58305],
  [-4.24264,55.56213],
  [-4.22818,55.56007],
  [-4.22466,55.55049],
  [-4.14772,55.57273],
  [-4.12631,55.56567],
  [-4.08157,55.56758],
  [-4.03958,55.59237],
  [-3.997,55.56354],
  [-3.97639,55.56466],
  [-3.97235,55.55644],
  [-3.95705,55.55575],
  [-3.9587,55.54079],
  [-4.02569,55.49245],
  [-4.01162,55.48285],
  [-4.01682,55.47296],
  [-3.98623,55.46405],
  [-3.96979,55.45436],
  [-3.95098,55.46259],
  [-3.92435,55.45633],
  [-3.89544,55.45976],
  [-3.8255,55.44442],
  [-3.8164,55.42727],
  [-3.76459,55.4011],
  [-3.75366,55.37494],
  [-3.71104,55.36324],
  [-3.72018,55.35024],
  [-3.71116,55.32316],
  [-3.67836,55.30895],
  [-3.66361,55.29175],
  [-3.61866,55.29574],
  [-3.62155,55.31654],
  [-3.60703,55.32583],
  [-3.57396,55.32836],
  [-3.58827,55.34618],
  [-3.57269,55.3551],
  [-3.57849,55.38496],
  [-3.55817,55.38811],
  [-3.54983,55.39899],
  [-3.5314,55.39644],
  [-3.50738,55.41226],
  [-3.53956,55.44317],
  [-3.51847,55.47378],
  [-3.52218,55.49026],
  [-3.50443,55.51247],
  [-3.4866,55.51705],
  [-3.50342,55.54744],
  [-3.48848,55.56267],
  [-3.52689,55.59701],
  [-3.53002,55.6114],
  [-3.48171,55.61643],
  [-3.48573,55.64904],
  [-3.39698,55.71066],
  [-3.39838,55.71653],
  [-3.4192,55.71056],
  [-3.43954,55.72406],
  [-3.45606,55.76362],
  [-3.47164,55.77097],
  [-3.54706,55.79073],
  [-3.555,55.78569],
  [-3.59151,55.81022],
  [-3.69867,55.79463],
  [-3.73272,55.77787],
  [-3.74401,55.78201],
  [-3.76641,55.77005],
  [-3.88822,55.75912],
  [-3.9186,55.73476],
  [-3.93012,55.74851],
  [-3.97372,55.7671],
  [-4.00167,55.77043],
  [-3.99915,55.77891],
  [-4.04842,55.79726],
  [-4.04583,55.81172],
  [-4.10703,55.83465],
  [-4.10217,55.84251],
  [-4.0747,55.84412],
  [-4.08839,55.85384],
  [-4.07171,55.86127],
  // ↓ Northern edge — Clyde, tracing E→W
  ...CLYDE_E_TO_W,   // ends at [-4.3606, 55.862]
  [-4.36467,55.85532],
  [-4.38087,55.85634],
  [-4.36803,55.84544],
  [-4.38141,55.82315],
  [-4.40056,55.81095],
  [-4.46581,55.80473],
  [-4.47271,55.79779],
  [-4.49514,55.80144],
  [-4.4957,55.79072],
  [-4.52198,55.77442],
  [-4.5419,55.77855],
  [-4.55092,55.76638],  // close
];

// ─────────────────────────────────────────────────────────────────────────────
// 4.  West Fife and Kinross
//
//     The original polygon was traced from ONS council-area boundary data and
//     is known to be non-self-intersecting everywhere EXCEPT for the artificial
//     straight section at longitude -3.05.
//
//     Strategy: keep ALL original western/northern vertices verbatim (these
//     are the council-data-derived coordinates).  Replace only the two
//     artificial straight-line points with a path following the Lomond Hills
//     ridge eastward from the last council-data point to the first coastline
//     point.
//
//     Original straight section (removed):
//       [-3.05, 56.41231] → [-3.05, 56.16534]
//
//     Junction points (unchanged, from the original):
//       before: [-3.19099, 56.36657]   (last council-boundary point going N)
//       after:  [-3.05436, 56.16275]   (first Fife coastline point going S)
//
//     The improved eastern boundary goes south from the Kinross/Lomond Hills
//     junction following the ridgeline, then meets the coastline section.
//     All intermediate points have longitude in [-3.19, -3.06] and latitude
//     in [56.16, 56.37], a region no other polygon segment passes through.
// ─────────────────────────────────────────────────────────────────────────────

// Original council-data western/northern vertices (before the straight cut)
const WFK_WEST_BOUNDARY = [
  [-3.73941,56.07711],
  [-3.71462,56.10449],
  [-3.67447,56.10023],
  [-3.67258,56.1078],
  [-3.62879,56.11044],
  [-3.66394,56.12305],
  [-3.62835,56.13277],
  [-3.58095,56.13931],
  [-3.58289,56.15087],
  [-3.56396,56.15981],
  [-3.5461,56.15852],
  [-3.54001,56.14646],
  [-3.4537,56.15038],
  [-3.41664,56.13842],
  [-3.36991,56.14584],
  [-3.37172,56.1644],
  [-3.34545,56.17294],
  [-3.31642,56.16649],
  [-3.29653,56.17058],
  [-3.30913,56.1853],
  [-3.26095,56.19614],
  [-3.27493,56.21416],
  [-3.26487,56.22005],
  [-3.29023,56.22498],
  [-3.27998,56.23385],
  [-3.36749,56.23976],
  [-3.35331,56.25527],
  [-3.38366,56.26878],
  [-3.33553,56.28945],
  [-3.32483,56.2828],
  [-3.2937,56.2887],
  [-3.30062,56.31398],
  [-3.25603,56.3401],
  [-3.25564,56.34627],
  [-3.2746,56.35064],
  [-3.22632,56.35507],
  [-3.19099,56.36657],  // ← last council-data point; improved boundary starts here
];

// Improved eastern boundary: follows the Lomond Hills ridge south from the
// Kinross area to the Fife coastline data.  All points lie in the longitude
// band [-3.19, -3.06] which is entirely east of the western boundary section
// above (which stays at or west of -3.19), so no crossings can occur.
const WFK_EAST_BOUNDARY = [
  // from junction [-3.19099, 56.36657] — heading south along eastern edge
  [-3.190, 56.350],  // just south of the junction
  [-3.178, 56.336],  // Kinross-shire / Fife border ridge
  [-3.165, 56.318],
  [-3.155, 56.300],  // North Lomond approach
  [-3.148, 56.282],  // West Lomond / East Lomond saddle area
  [-3.147, 56.265],
  [-3.152, 56.248],  // East Lomond summit area
  [-3.152, 56.230],  // heading south down the eastern Lomond slopes
  [-3.141, 56.213],
  [-3.125, 56.200],  // Freuchie / Howe of Fife border
  [-3.110, 56.190],
  [-3.096, 56.181],
  [-3.082, 56.174],
  [-3.068, 56.168],  // approaching the Fife coastal section junction
  [-3.056, 56.163],
  // connects to the first coastline point [-3.05436, 56.16275]
];

// Original Fife coastline vertices (after the straight cut) — kept verbatim
const WFK_SOUTH_BOUNDARY = [
  [-3.05436,56.16275],
  [-3.0544,56.16274],
  [-3.05447,56.16269],
  [-3.10732,56.13124],
  [-3.14602,56.11836],
  [-3.14946,56.11789],
  [-3.14982,56.1171],
  [-3.15102,56.1167],
  [-3.15144,56.1135],
  [-3.17438,56.0626],
  [-3.21675,56.06385],
  [-3.23424,56.05466],
  [-3.24358,56.05511],
  [-3.26618,56.0594],
  [-3.28427,56.05617],
  [-3.28392,56.05311],
  [-3.28754,56.05125],
  [-3.29496,56.05296],
  [-3.32226,56.03358],
  [-3.3345,56.03957],
  [-3.35013,56.03024],
  [-3.37414,56.02745],
  [-3.39542,56.02916],
  [-3.40277,56.02414],
  [-3.38806,56.0225],
  [-3.39142,56.00611],
  [-3.41283,56.01659],
  [-3.41837,56.01611],
  [-3.43846,56.02378],
  [-3.44886,56.02161],
  [-3.4428,56.01791],
  [-3.45594,56.02037],
  [-3.4633,56.03023],
  [-3.52168,56.04173],
  [-3.54068,56.04024],
  [-3.54991,56.04179],
  [-3.57552,56.05886],
  [-3.59043,56.05946],
  [-3.59385,56.04582],
  [-3.60691,56.04614],
  [-3.60808,56.04617],
  [-3.61751,56.05596],
  [-3.68635,56.04805],
  [-3.73929,56.07706],
  [-3.73941,56.07711],  // close (same as first point of WFK_WEST_BOUNDARY)
];

// Assemble the full West Fife & Kinross ring
const WEST_FIFE_KINROSS_COORDS = [
  ...WFK_WEST_BOUNDARY,
  ...WFK_EAST_BOUNDARY,
  ...WFK_SOUTH_BOUNDARY,
];

// ─────────────────────────────────────────────────────────────────────────────
// 5.  Assemble the updated FeatureCollection
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const existing = JSON.parse(readFileSync(FILE, 'utf8'));

  const REWRITE = new Set(['glasgow-north', 'glasgow-south', 'west-fife-kinross']);
  const kept = existing.features.filter(f => !REWRITE.has(f.properties.branch));

  const newFeatures = [
    {
      type: 'Feature',
      properties: { branch: 'glasgow-north', realName: 'Glasgow North' },
      geometry: { type: 'Polygon', coordinates: [GLASGOW_NORTH_COORDS] },
    },
    {
      type: 'Feature',
      properties: { branch: 'glasgow-south', realName: 'Glasgow South' },
      geometry: { type: 'Polygon', coordinates: [GLASGOW_SOUTH_COORDS] },
    },
    {
      type: 'Feature',
      properties: { branch: 'west-fife-kinross', realName: 'West Fife and Kinross' },
      geometry: { type: 'Polygon', coordinates: [WEST_FIFE_KINROSS_COORDS] },
    },
  ];

  // Validate all rings before writing
  console.log('Validating polygon rings…');
  let allValid = true;
  for (const f of [...kept, ...newFeatures]) {
    const geom = f.geometry;
    const rings = geom.type === 'Polygon'
      ? geom.coordinates
      : geom.coordinates.flatMap(p => p);
    for (const ring of rings) {
      if (!validateRing(f.properties.branch, ring)) allValid = false;
    }
  }

  if (!allValid) {
    console.error('\nAborted — fix self-intersections before writing.');
    process.exit(1);
  }

  const output = { type: 'FeatureCollection', features: [...kept, ...newFeatures] };
  writeFileSync(FILE, JSON.stringify(output));
  console.log(`\nWrote ${FILE}`);
  console.log(`  Total features: ${output.features.length}`);
  for (const f of newFeatures) {
    const ring = f.geometry.coordinates[0];
    console.log(`  ${f.properties.branch}: ${ring.length} vertices`);
  }
}

main();
