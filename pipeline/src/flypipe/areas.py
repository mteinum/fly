"""Definisjon av kartutsnitt."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Area:
    id: str
    name: str
    icao: str  # utsnittet sentreres på flyplassens referansepunkt
    cell: float = 50.0  # m, spillrutenett
    size: int = 512  # celler per side (512 * 50 m = 25,6 km)
    source_res: float = 10.0  # m, oppløsning hentet fra WCS
    n50_county: str = ""  # fylkesfil for N50, f.eks. "42_Agder"


AREAS = {
    "kjevik": Area(id="kjevik", name="Kristiansand lufthavn, Kjevik", icao="ENCN", n50_county="42_Agder"),
}
