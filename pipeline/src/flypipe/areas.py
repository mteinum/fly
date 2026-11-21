"""Definisjon av kartutsnitt."""

from __future__ import annotations

from dataclasses import dataclass


# Navnene vises i spillet, som er på engelsk.
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
    # True: hillshade (fast sol i sørvest) ganges inn i fargekartet.
    # False: fargekartet er ren flatefarge, og spillet lyssetter selv etter tid på døgnet.
    bake_hillshade: bool = True
    night_lights: bool = False  # skriv lights.png (gatelys og vinduslys, syntetisk plassert)
    # True: bygningspunkter fra Matrikkelen (alle bygg) i stedet for N50 (et utvalg). Samme fylkeskode som N50.
    matrikkel_buildings: bool = False
    # True: bygningene får form fra OpenStreetMap-omriss (data/osm/<id>.npz, ODbL). Krever matrikkel_buildings.
    osm_footprints: bool = False
    # Flytt utsnittets sentrum (øst, nord i m) fra flyplassens referansepunkt, for å få med noe som ellers kuttes
    center_offset: tuple[float, float] = (0.0, 0.0)

    @property
    def raw_id(self) -> str:
        return self.cache or self.id


def _airport_10m(id: str, name: str, icao: str, county: str, cache: str = "", center_offset: tuple[float, float] = (0.0, 0.0)) -> Area:
    """10 m-utsnitt rundt en flyplass, slik spillet bruker det."""
    return Area(
        id=id, name=name, icao=icao, n50_county=county, cell=10.0, size=2560, cache=cache, center_offset=center_offset,
        # 10 m-celler tåler hele bilveinettet; på 50 m ville kommunale og private veier fylt byen
        road_categories=("E", "R", "F", "K", "P"),
        steep_slope=1.0,  # helning målt over 20 m er brattere enn over 100 m
        dom_building_heights=True,
        bake_hillshade=False,
        night_lights=True,
        matrikkel_buildings=True,
        osm_footprints=True,
    )


# Kjevik-utsnittet er flyttet 3,5 km sørover så hele Flekkerøya (sørspiss ved nord 6 456 800) kommer med.
# Innflygingen til bane 21 starter 8 km nordøst for banen og har fortsatt 2,5 km til kartkanten.
KJEVIK_OFFSET = (0.0, -3500.0)

AREAS = {
    # 50 m: grovt nivå. Brukes ikke av spillet nå, men av testene og av blokkmiddel-kontrollen
    "kjevik": Area(id="kjevik", name="Kristiansand Airport, Kjevik", icao="ENCN", n50_county="42_Agder", center_offset=KJEVIK_OFFSET),
    # 10 m: det spillet bruker. kjevik10 har samme bbox som kjevik, så rådata deles.
    "kjevik10": _airport_10m("kjevik10", "Kristiansand Airport, Kjevik", "ENCN", "42_Agder", cache="kjevik", center_offset=KJEVIK_OFFSET),
    "sola10": _airport_10m("sola10", "Stavanger Airport, Sola", "ENZV", "11_Rogaland"),
    "flesland10": _airport_10m("flesland10", "Bergen Airport, Flesland", "ENBR", "46_Vestland"),
    "gardermoen10": _airport_10m("gardermoen10", "Oslo Airport, Gardermoen", "ENGM", "32_Akershus"),
    "bodo10": _airport_10m("bodo10", "Bodø Airport", "ENBO", "18_Nordland"),
    # Mehamn ligger 12,8° øst for sentralmeridianen i UTM 33: konvergensen er +12,15° (de andre er negative)
    "mehamn10": _airport_10m("mehamn10", "Mehamn Airport", "ENMH", "56_Finnmark"),
}
