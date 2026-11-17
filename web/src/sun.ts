/* Solas posisjon fra tid og sted. Lavpresisjonsformler (Astronomical Almanac),
 * nøyaktige til ca. 0,01° mellom 1950 og 2050 - mer enn nok til lyssetting. */

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Sann asimut i grader: 0 = nord, med klokka. */
  azimuthDeg: number;
  /** Høyde over horisonten i grader. Uten refraksjon. */
  elevationDeg: number;
}

export function sunPosition(utcMs: number, latDeg: number, lonDeg: number): SunPosition {
  const d = utcMs / 86400000 + 2440587.5 - 2451545.0; // døgn siden J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD; // middelanomali
  const q = 280.459 + 0.98564736 * d; // middellengde
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ekliptisk lengde
  const e = (23.439 - 0.00000036 * d) * RAD; // ekliptikkens helning
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908 * d; // timer
  const ha = (gmst * 15 + lonDeg) * RAD - ra; // timevinkel, positiv vest for meridianen
  const lat = latDeg * RAD;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const azimuth = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { azimuthDeg: ((azimuth / RAD) % 360 + 360) % 360, elevationDeg: elevation / RAD };
}
