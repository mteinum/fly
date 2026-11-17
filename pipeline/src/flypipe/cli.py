from __future__ import annotations

import argparse

from .areas import AREAS
from .build import build


def main() -> None:
    parser = argparse.ArgumentParser(prog="flypipe", description="Bygg spillfliser fra norske geodata")
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="hent data og skriv fliser til web/public/data/<utsnitt>/")
    b.add_argument("area", nargs="?", default="kjevik", choices=sorted(AREAS))
    args = parser.parse_args()
    if args.cmd == "build":
        build(AREAS[args.area])


if __name__ == "__main__":
    main()
