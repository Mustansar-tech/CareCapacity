// Fetch NRS unit postcode points (POSTCODE, EASTING, NORTHING in EPSG:27700) from ArcGIS.
// Usage pattern (two passes):
//   1. Pass A: fetch by district WHERE clause to learn the territory's own bbox.
//   2. Pass B: fetch EVERYTHING in that bbox expanded by MARGIN (>= 15000 m!) for Voronoi context.
// Edit CONFIG below, then: node fetch-points.mjs
import { writeFile } from "fs/promises";

const BASE =
  "https://services-eu1.arcgis.com/wdfNi1bRjans3E0y/arcgis/rest/services/NRS_Postcode_Point/FeatureServer/41/query";

// ---- CONFIG ----
const MODE = "bbox"; // "districts" (pass A) or "bbox" (pass B)
const DISTRICTS = ["G1", "G2"]; // pass A: outward codes of the territory
const BBOX = { minE: 250864, maxE: 270050, minN: 662614, maxN: 679556 }; // pass A output
const MARGIN = 15000; // metres; NEVER less than 15000 for pass B
const OUT = "work/context-points.json";
// ----------------

async function query(extraParams) {
  const out = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      outFields: "POSTCODE,EASTING,NORTHING",
      returnGeometry: "false",
      resultRecordCount: "2000",
      resultOffset: String(offset),
      f: "json",
      ...extraParams,
    });
    const j = await (await fetch(`${BASE}?${params}`)).json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    out.push(...j.features.map((f) => f.attributes));
    if (!j.exceededTransferLimit) break;
    offset += j.features.length;
  }
  return out;
}

let pts;
if (MODE === "districts") {
  // POSTCODE format is like "G1 1AA" — match "<district> " prefix
  const where = DISTRICTS.map((d) => `POSTCODE LIKE '${d} %'`).join(" OR ");
  pts = await query({ where });
  const es = pts.map((p) => p.EASTING), ns = pts.map((p) => p.NORTHING);
  console.log("bbox:", { minE: Math.min(...es), maxE: Math.max(...es), minN: Math.min(...ns), maxN: Math.max(...ns) });
} else {
  const geom = {
    xmin: BBOX.minE - MARGIN, ymin: BBOX.minN - MARGIN,
    xmax: BBOX.maxE + MARGIN, ymax: BBOX.maxN + MARGIN,
    spatialReference: { wkid: 27700 },
  };
  pts = await query({
    geometry: JSON.stringify(geom),
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    inSR: "27700",
  });
}
console.log("points:", pts.length);
await writeFile(OUT, JSON.stringify(pts));
