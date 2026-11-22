from __future__ import annotations

import argparse

from .areas import AREAS
from .build import build


def main() -> None:
    parser = argparse.ArgumentParser(prog="flypipe", description="Bygg spillfliser fra norske geodata")
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="hent data og skriv fliser til web/public/data/<utsnitt>/")
    b.add_argument("area", nargs="?", default="kjevik10", choices=[*sorted(AREAS), "all"], help="utsnitt, eller «all» for alle")
    sub.add_parser("audio", help="generer lyd med ElevenLabs til web/public/audio/ (krever ELEVENLABS_API_KEY)")
    o = sub.add_parser("osm", help="hent bygningsomriss fra OpenStreetMap (Overpass) til data/osm/<utsnitt>.npz")
    o.add_argument("area", choices=sorted(AREAS))
    w = sub.add_parser("aeroways", help="hent taksebaner, oppstillingsflater og stands fra OpenStreetMap til data/osm/<utsnitt>.aeroway.json")
    w.add_argument("area", choices=sorted(AREAS))
    rl = sub.add_parser("rails", help="hent jernbane, T-bane, trikk og bybane fra OpenStreetMap til data/osm/<utsnitt>.rail.json")
    rl.add_argument("area", choices=sorted(AREAS))
    sub.add_parser("mcp", help="start MCP-serveren for gjennomgang av flylogger (krever --group agent)")
    d = sub.add_parser("debrief", help="skriv hovedtallene for en flylogg i data/flights/ som JSON")
    d.add_argument("flight", nargs="?", default="latest", help="filnavn, eller «latest»")
    args = parser.parse_args()
    if args.cmd == "build":
        for name in AREAS if args.area == "all" else [args.area]:
            build(AREAS[name])
    elif args.cmd == "audio":
        from .audio import generate
        from .build import RAW, TILES

        generate(TILES.parent / "audio", RAW)
    elif args.cmd in ("osm", "aeroways", "rails"):
        from . import airports, osm
        from .build import RAW
        from .grid import GridSpec

        area = AREAS[args.area]
        arp = airports.load_airport(area.icao, RAW)["arp"]
        grid = GridSpec.centered(arp["east"] + area.center_offset[0], arp["north"] + area.center_offset[1], area.cell, area.size)
        {"osm": osm.fetch, "aeroways": osm.fetch_aeroways, "rails": osm.fetch_rails}[args.cmd](area.id, grid, RAW)
    elif args.cmd == "mcp":
        from .mcp_server import main as serve

        serve()
    elif args.cmd == "debrief":
        import json

        from . import debrief

        print(json.dumps(debrief.summary(debrief.load(args.flight)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
