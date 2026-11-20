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
    args = parser.parse_args()
    if args.cmd == "build":
        for name in AREAS if args.area == "all" else [args.area]:
            build(AREAS[name])
    elif args.cmd == "audio":
        from .audio import generate
        from .build import RAW, TILES

        generate(TILES.parent / "audio", RAW)


if __name__ == "__main__":
    main()
