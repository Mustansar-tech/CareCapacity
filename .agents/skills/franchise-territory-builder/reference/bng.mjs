// OSGB36 British National Grid (EPSG:27700) easting/northing -> WGS84 lon/lat.
// Standard OS algorithm: inverse Transverse Mercator on Airy 1830, then a
// 7-parameter Helmert transform OSGB36 -> WGS84.
// VERIFY before trusting: Glasgow George Square E259208 N665379 -> ~[-4.2514, 55.8609] (<20 m error).

const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

// Airy 1830 ellipsoid + National Grid projection constants
const a = 6377563.396, b = 6356256.909;
const F0 = 0.9996012717;
const lat0 = rad(49), lon0 = rad(-2);
const N0 = -100000, E0 = 400000;
const e2 = 1 - (b * b) / (a * a);
const n = (a - b) / (a + b);

function osgb36GridToLatLon(E, N) {
  let lat = lat0, M = 0;
  do {
    lat = (N - N0 - M) / (a * F0) + lat;
    const dLat = lat - lat0, sLat = lat + lat0;
    M =
      b * F0 *
      ((1 + n + (5 / 4) * n * n + (5 / 4) * n * n * n) * dLat -
        (3 * n + 3 * n * n + (21 / 8) * n * n * n) * Math.sin(dLat) * Math.cos(sLat) +
        ((15 / 8) * n * n + (15 / 8) * n * n * n) * Math.sin(2 * dLat) * Math.cos(2 * sLat) -
        (35 / 24) * n * n * n * Math.sin(3 * dLat) * Math.cos(3 * sLat));
  } while (Math.abs(N - N0 - M) >= 0.00001);

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const VII = tanLat / (2 * rho * nu);
  const VIII = (tanLat / (24 * rho * nu ** 3)) * (5 + 3 * tanLat ** 2 + eta2 - 9 * tanLat ** 2 * eta2);
  const IX = (tanLat / (720 * rho * nu ** 5)) * (61 + 90 * tanLat ** 2 + 45 * tanLat ** 4);
  const X = 1 / (cosLat * nu);
  const XI = (1 / (cosLat * 6 * nu ** 3)) * (nu / rho + 2 * tanLat ** 2);
  const XII = (1 / (cosLat * 120 * nu ** 5)) * (5 + 28 * tanLat ** 2 + 24 * tanLat ** 4);
  const XIIA = (1 / (cosLat * 5040 * nu ** 7)) * (61 + 662 * tanLat ** 2 + 1320 * tanLat ** 4 + 720 * tanLat ** 6);

  const dE = E - E0;
  const latOut = lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lonOut = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  return [latOut, lonOut]; // radians, on Airy/OSGB36 datum
}

function helmertOSGB36toWGS84(latR, lonR) {
  // geodetic (Airy) -> cartesian
  const sinLat = Math.sin(latR), cosLat = Math.cos(latR);
  const nu = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const H = 0;
  let x = (nu + H) * cosLat * Math.cos(lonR);
  let y = (nu + H) * cosLat * Math.sin(lonR);
  let z = ((1 - e2) * nu + H) * sinLat;

  // Helmert OSGB36 -> WGS84 (inverse of the published WGS84->OSGB36 params)
  const tx = 446.448, ty = -125.157, tz = 542.06;
  const s = -20.4894e-6; // scale ppm
  const rx = rad(0.1502 / 3600), ry = rad(0.247 / 3600), rz = rad(0.8421 / 3600);
  const x2 = tx + (1 + s) * x + -rz * y + ry * z;
  const y2 = ty + rz * x + (1 + s) * y + -rx * z;
  const z2 = tz + -ry * x + rx * y + (1 + s) * z;

  // cartesian -> geodetic on GRS80/WGS84
  const aW = 6378137.0, bW = 6356752.3142;
  const e2W = 1 - (bW * bW) / (aW * aW);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let lat = Math.atan2(z2, p * (1 - e2W));
  for (let i = 0; i < 10; i++) {
    const sLat = Math.sin(lat);
    const nuW = aW / Math.sqrt(1 - e2W * sLat * sLat);
    lat = Math.atan2(z2 + e2W * nuW * sLat, p);
  }
  const lon = Math.atan2(y2, x2);
  return [deg(lat), deg(lon)];
}

/** Convert BNG easting/northing (m) to [lon, lat] WGS84 (GeoJSON order). */
export function osgb36ToWGS84(E, N) {
  const [latR, lonR] = osgb36GridToLatLon(E, N);
  const [lat, lon] = helmertOSGB36toWGS84(latR, lonR);
  return [lon, lat];
}
