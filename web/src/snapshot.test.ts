/* Infoteksten på delingsbildet. */
import { describe, expect, it } from "vitest";
import { osloToUtc } from "./clock";
import { newPlane } from "./plane";
import { nearestPlace, snapshotInfo } from "./snapshot";
import { hasTiles, loadTestTerrain } from "./testTerrain";

describe.skipIf(!hasTiles("kjeller10"))("delingsbildet", () => {
  if (!hasTiles("kjeller10")) return;
  const t = loadTestTerrain("kjeller10"), airport = { icao: "ENKJ", name: "Kjeller Airport" };
  const at = (east: number, north: number) => t.utmToGrid(east, north);
  const noon = osloToUtc({ year: 2026, month: 11, day: 22, hour: 13, minute: 5 });

  it("sier hvilket sted flyet er over", () => {
    const [x, y] = at(262565, 6648729); // Operaen
    expect(nearestPlace(t, x, y)).toBe("Oslo");
    expect(nearestPlace(t, ...at(259960, 6645620))).toBe("Oslo"); // starten på byturen, ute på fjorden
    const info = snapshotInfo(t, airport, Object.assign(newPlane(), { x, y, alt: 450, spd: 82, state: "fly" }), noon);
    expect(info.headline).toBe("Over Oslo");
    expect(info.detail).toEqual(["Airbus A320 · 1480 ft · 159 kt", "ENKJ Kjeller Airport · 22 Nov 2026 13:05"]);
    expect(info.fileName).toBe("fly-teinum-ENKJ-2026-11-22-1305");
    // signalbygg i bildet (sightseeing) gir overskriften, med stedet etter
    const withSights = snapshotInfo(t, airport, Object.assign(newPlane(), { x, y, alt: 450, spd: 82, state: "fly" }), noon, ["Operaen", "Munchmuseet"]);
    expect(withSights.headline).toBe("Operaen and Munchmuseet, Oslo");
  });

  it("sier at flyet står på flyplassen etter landing, uten høyde og fart", () => {
    const end = t.meta.airports[0].runways[0].ends[0], P = Object.assign(newPlane(), { x: end.x, y: end.y, alt: 106, spd: 0, state: "landed", parked: true });
    const info = snapshotInfo(t, airport, P, noon);
    expect(info.headline).toBe("Parked at Kjeller Airport");
    expect(info.detail).toEqual(["Airbus A320", "ENKJ Kjeller Airport · 22 Nov 2026 13:05"]);
  });
});
