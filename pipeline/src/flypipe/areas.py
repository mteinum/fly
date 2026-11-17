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
    cache: str = ""  # mappe i data/raw/ (standard: id). Utsnitt med samme bbox kan dele rådata
    road_categories: tuple[str, ...] = ("E", "R", "F")  # vegkategorier som tegnes
    steep_slope: float = 0.6  # stigningstall der skog/åpent område farges som berg
    dom_building_heights: bool = False  # høyde på store bygg fra DOM - DTM

    @property
    def raw_id(self) -> str:
        return self.cache or self.id


AREAS = {
    # 50 m: pikselmodus (sprite stack + Voxel Space)
    "kjevik": Area(id="kjevik", name="Kristiansand lufthavn, Kjevik", icao="ENCN", n50_county="42_Agder"),
    # 10 m: 3D-modus (WebGL). Samme bbox, så rådata deles med "kjevik".
    "kjevik10": Area(
        id="kjevik10", name="Kristiansand lufthavn, Kjevik (10 m)", icao="ENCN", n50_county="42_Agder",
        cell=10.0, size=2560, cache="kjevik",
        # 10 m-celler tåler hele bilveinettet; på 50 m ville kommunale og private veier fylt byen
        road_categories=("E", "R", "F", "K", "P"),
        steep_slope=1.0,  # helning målt over 20 m er brattere enn over 100 m
        dom_building_heights=True,
    ),
}
