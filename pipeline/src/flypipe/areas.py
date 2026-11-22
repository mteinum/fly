"""Definisjon av kartutsnitt."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Tour:
    """Et startsted for en tur over noe verdt å se, med banen turen ender på."""

    name: str  # vises i spillet (engelsk)
    runway: str  # baneenden flyet skal lande på etterpå
    east: float  # UTM 33 (m)
    north: float
    altitude_m: float  # NN2000
    heading_true_deg: float


# Navnene vises i spillet, som er på engelsk.
@dataclass(frozen=True)
class Area:
    id: str
    name: str
    icao: str  # utsnittet sentreres på flyplassens referansepunkt
    cell: float = 50.0  # m, spillrutenett
    size: int = 512  # celler per side (512 * 50 m = 25,6 km)
    source_res: float = 10.0  # m, oppløsning hentet fra WCS
    n50_county: str = ""  # fylkesfil for N50, f.eks. "42_Agder". Over en fylkesgrense: "32_Akershus+03_Oslo"
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
    # Sightseeing: ekstra startsteder i tillegg til innflygingene. Valgt for hånd, ikke en publisert rute.
    tours: tuple[Tour, ...] = ()

    @property
    def raw_id(self) -> str:
        return self.cache or self.id


def _airport_10m(id: str, name: str, icao: str, county: str, cache: str = "", center_offset: tuple[float, float] = (0.0, 0.0), size: int = 2560,
                 tours: tuple[Tour, ...] = ()) -> Area:
    """10 m-utsnitt rundt en flyplass, slik spillet bruker det."""
    return Area(
        id=id, name=name, icao=icao, n50_county=county, cell=10.0, size=size, cache=cache, center_offset=center_offset, tours=tours,
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
    "tromso10": _airport_10m("tromso10", "Tromsø Airport, Langnes", "ENTC", "55_Troms"),
    # Ålesund ligger 10 km sør for flyplassen på Vigra: utsnittet er flyttet 4,5 km sørover så hele byen er med.
    # Innflygingene (8 km fra hver baneende, nordøst og sørvest for banen) har fortsatt over 3 km til kartkanten.
    "alesund10": _airport_10m("alesund10", "Ålesund Airport, Vigra", "ENAL", "15_More_og_Romsdal", center_offset=(0.0, -4500.0)),
    # Kjeller ligger 16,5 km øst og 5,9 km nord for Operaen i Bjørvika. Utsnittet er større enn de andre (30,7 km)
    # og flyttet 6 km vestover og 3 km sørover, så det rekker fra Holmenkollen og Bygdøy i vest til 2,5 km bak starten
    # på innflygingen til bane 30 i øst. Det ligger i to fylker.
    "kjeller10": _airport_10m("kjeller10", "Kjeller Airport", "ENKJ", "32_Akershus+03_Oslo", center_offset=(-6000.0, -3000.0), size=3072,
                              # Fra fjorden vest for Hovedøya, kurs 040° rett over Operaen (4 km fram) og videre opp Groruddalen
                              # til starten på innflygingen til bane 12 (14,5 km etter Operaen, 83° høyresving inn)
                              tours=(Tour("Oslo city", "12", 259960.0, 6645620.0, 450.0, 40.0),)),
}
