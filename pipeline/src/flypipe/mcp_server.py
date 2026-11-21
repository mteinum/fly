"""MCP-server som gir en KI-agent (f.eks. Claude Code) verktøy for å gå gjennom flylogger fra spillet.

Startes med `uv run --group agent flypipe mcp` (se .mcp.json i roten). Kjører bare lokalt, over stdio:
ingenting her er publisert, og serveren leser bare filer i data/flights/ og de bygde flisene.
All regning skjer i debrief.py; verktøyene under er tynne innpakninger.
"""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from . import debrief


def _load(flight: str) -> dict:
    """Les loggen, og si fra til agenten i klartekst når den ikke finnes (så den kan rette seg selv)."""
    try:
        return debrief.load(flight)
    except (ValueError, OSError) as err:
        raise ToolError(f"{err}. Call list_flights to see the available file names.") from err

server = MCPServer(
    "teinum-fly",
    instructions=(
        "Flight logs from the teinum-fly simulator (an A320 approach and landing at a Norwegian airport). "
        "Start with flight_summary. Every number you state must come from a tool result: do not estimate, "
        "and do not rely on what you remember about the airport. The glide path is synthetic (3 degrees from the "
        "runway end), not the airport's real ILS."
    ),
)


@server.tool()
def list_flights() -> list[dict]:
    """List the recorded approaches, newest first: file name, airport, runway, outcome and stars."""
    return debrief.list_flights()


@server.tool()
def flight_summary(flight: str = "latest") -> dict:
    """Key facts for one approach: outcome, touchdown, grade, events (gear, flaps, warnings), the state at the
    1000 ft and 500 ft gates with a stabilised-approach check, worst deviation from centreline and glide path,
    speed margins, and the last seconds before the ground. `flight` is a file name from list_flights, or "latest"."""
    return debrief.summary(_load(flight))


@server.tool()
def flight_samples(flight: str = "latest", from_s: float = 0, to_s: float = 100000, every_s: float = 5) -> dict:
    """The recorded samples between two times (seconds from the start), thinned to one per `every_s` seconds.
    Use it to look closely at a part of the approach that flight_summary points to."""
    return debrief.samples(_load(flight), from_s, to_s, every_s)


@server.tool()
def terrain_profile(flight: str = "latest", every_s: float = 5) -> dict:
    """Terrain height under the aircraft, clearance above it, and the nearest place name (from N50 map data)
    along the track. Use it to say where things happened and how close the terrain was. Terrain only:
    buildings and bridges are not included."""
    try:
        return debrief.terrain_profile(_load(flight), every_s=every_s)
    except FileNotFoundError as err:
        raise ToolError(str(err)) from err


def main() -> None:
    server.run("stdio")
