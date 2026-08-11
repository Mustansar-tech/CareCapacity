// Build one territory polygon from Voronoi cells of unit postcode points.
// Requires (one-off, remove after): npm install --no-save d3-delaunay @turf/turf
// MUST be run from the workspace root (node resolves d3-delaunay/@turf from ./node_modules).
// Edit CONFIG, then: node .agents/skills/franchise-territory-builder/reference/build-territory.mjs
import { readFileSync, writeFileSync } from "fs";
import { Delaunay } from "d3-delaunay";
import * as turf from "@turf/turf";
import { osgb36ToWGS84 } from "./bng.mjs";

// ---- CONFIG ----
const CONTEXT_POINTS = "work/context-points.json"; // pass-B output of fetch-points.mjs
const SECTORS_FILE = "work/sectors.json";          // ["G1 1", "G1 2", ...] from the Excel
const SLUG = "glasgow-north";                       // branches.name slug, or null for independents
const REAL_NAME = "Glasgow North";                  // Territory name from the Excel
// Clip bounds MUST equal the pass-B fetch envelope (bbox +/- MARGIN):
const CLIP = { minE: 235864, maxE: 285050, minN: 647614, maxN: 694556 };
const OUT = "work/territory.geo.json";
// ----------------

const points = JSON.parse(readFileSync(CONTEXT_POINTS, "utf8"));
const targetSectors = new Set(JSON.parse(readFileSync(SECTORS_FILE, "utf8")));

// sector = outward code + " " + first digit of inward code, e.g. "G1 1AA" -> "G1 1"
function sectorOf(postcode) {
  const m = postcode.trim().match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d)[A-Z]{2}$/i);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : null;
}

const coords = points.map((p) => [p.EASTING, p.NORTHING]);
const delaunay = Delaunay.from(coords);
const voronoi = delaunay.voronoi([CLIP.minE, CLIP.minN, CLIP.maxE, CLIP.maxN]);

const allSectors = new Set();
const cellPolys = [];
for (let i = 0; i < points.length; i++) {
  const sec = sectorOf(points[i].POSTCODE);
  if (!sec) continue;
  allSectors.add(sec);
  if (!targetSectors.has(sec)) continue;
  const cell = voronoi.cellPolygon(i);
  if (!cell || cell.length < 4) continue;
  cellPolys.push(turf.polygon([cell]));
}

console.log("distinct sectors in context", allSectors.size);
const found = [...targetSectors].filter((s) => allSectors.has(s));
const missing = [...targetSectors].filter((s) => !allSectors.has(s));
console.log(`target sectors found ${found.length} / ${targetSectors.size}`);
console.log("missing sectors", missing); // MUST be [] — otherwise fix the sector list or widen the fetch

// union all cells (batch to keep turf fast)
let merged = cellPolys[0];
for (let i = 1; i < cellPolys.length; i++) {
  merged = turf.union(turf.featureCollection([merged, cellPolys[i]]));
}
merged = turf.simplify(merged, { tolerance: 15, highQuality: true, mutate: true }); // metres (still in BNG)

// reproject BNG -> WGS84
function reprojectRing(ring) { return ring.map(([e, n]) => osgb36ToWGS84(e, n)); }
const g = merged.geometry;
const wgsCoords = g.type === "Polygon" ? g.coordinates.map(reprojectRing) : g.coordinates.map((p) => p.map(reprojectRing));
const feature = {
  type: "Feature",
  properties: { branch: SLUG, realName: REAL_NAME },
  geometry: { type: g.type, coordinates: wgsCoords },
};
writeFileSync(OUT, JSON.stringify(feature));
console.log("done, geometry type", g.type);
console.log("coord count", JSON.stringify(wgsCoords).length > 0 ? wgsCoords.flat(g.type === "Polygon" ? 1 : 2).length : 0);
// If type is MultiPolygon, inspect why — territories should normally be a single Polygon.
