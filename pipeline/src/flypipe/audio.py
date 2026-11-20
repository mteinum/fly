"""Lyd til spillet, generert med ElevenLabs: lydeffekter og tale.

Kjøres som `uv run flypipe audio`. Krever ELEVENLABS_API_KEY i miljøet. Nøkkelen
brukes bare her og skrives aldri til fil; spillet får ferdige mp3-filer.

Tjenester (verifisert 2026-11-20):
  POST https://api.elevenlabs.io/v1/sound-generation        {"text", "duration_seconds", "prompt_influence", "loop"}
  POST https://api.elevenlabs.io/v1/text-to-speech/{voice}  {"text", "model_id"}

Generert lyd er IKKE reproduserbar: samme tekst gir ny lyd hver gang. Filer som
finnes fra før hentes derfor ikke på nytt (slett fila for å lage en ny), og
manifest.json sier hvilken tekst og stemme hver fil kom fra.

Alt her er syntetisk. Ingen av lydene er opptak av et fly eller av Kjevik tårn.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import requests

API = "https://api.elevenlabs.io/v1"
TTS_MODEL = "eleven_multilingual_v2"
VOICE_CALLOUT = ("onwK4e9ZLuTAKqWW03F9", "Daniel")  # flyets automatiske utrop
VOICE_TOWER = ("cjVigY5qzO86Huf0OWal", "Eric")  # flygeleder

# navn -> (beskrivelse, sekunder, sløyfe)
EFFECTS: dict[str, tuple[str, float, bool]] = {
    "engine": ("Steady continuous hum and whine of twin turbofan jet engines heard from inside an airliner cockpit, constant pitch, no voices, no music", 6, True),
    "wind": ("Steady continuous airflow wind noise around an airliner cockpit in flight, constant hiss, no voices", 5, True),
    "tower_room": ("Quiet air traffic control tower room tone: soft ventilation and faint electronic equipment hum, no voices", 6, True),
    "gear": ("Aircraft landing gear extending: hydraulic whine, then a heavy mechanical clunk as it locks", 4, False),
    "flaps": ("Electric motor whirring as aircraft wing flaps move, short, mechanical", 3, False),
    "touchdown": ("Airliner main wheels touching down on a runway: brief tyre screech and a low thump with rumble", 3, False),
    "crash": ("Heavy aircraft crash impact: metal crunching and debris, short", 3, False),
    "splash": ("Very large object hitting water at speed: huge splash", 3, False),
    "warning": ("Aircraft cockpit master warning: urgent repetitive electronic chime, three beeps", 2, False),
    "radio": ("Short burst of aviation radio static and a click as a transmission starts", 1, False),
}

# navn -> (stemme, tekst). Kallesignalet «Teinum 320» er oppdiktet.
SPEECH: dict[str, tuple[tuple[str, str], str]] = {
    **{f"alt_{n}": (VOICE_CALLOUT, t) for n, t in [
        (1000, "One thousand"), (500, "Five hundred"), (400, "Four hundred"), (300, "Three hundred"), (200, "Two hundred"),
        (100, "One hundred"), (50, "Fifty"), (40, "Forty"), (30, "Thirty"), (20, "Twenty"), (10, "Ten"),
    ]},
    "retard": (VOICE_CALLOUT, "Retard. Retard."),
    "too_low_gear": (VOICE_CALLOUT, "Too low, gear."),
    "stall": (VOICE_CALLOUT, "Stall! Stall!"),
    "cleared_03": (VOICE_TOWER, "Teinum three two zero, Kjevik tower. Runway zero three, cleared to land. Wind calm."),
    "cleared_21": (VOICE_TOWER, "Teinum three two zero, Kjevik tower. Runway two one, cleared to land. Wind calm."),
    "welcome": (VOICE_TOWER, "Teinum three two zero, welcome to Kjevik. Vacate when able."),
    "go_around": (VOICE_TOWER, "Teinum three two zero, check gear down."),
}


def _post(path: str, body: dict, key: str) -> bytes:
    r = requests.post(f"{API}/{path}", json=body, headers={"xi-api-key": key}, timeout=180)
    if r.status_code != 200 or "audio" not in r.headers.get("content-type", ""):
        raise RuntimeError(f"ElevenLabs {path}: {r.status_code} {r.text[:300]}")
    return r.content


def generate(out: Path) -> None:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise SystemExit("ELEVENLABS_API_KEY er ikke satt")
    out.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    for name, (prompt, seconds, loop) in EFFECTS.items():
        path = out / f"{name}.mp3"
        if not path.exists():
            print(f"  lydeffekt: {name}")
            path.write_bytes(_post("sound-generation", {"text": prompt, "duration_seconds": seconds, "prompt_influence": 0.5, "loop": loop}, key))
        manifest[name] = {"file": path.name, "kind": "effect", "loop": loop, "prompt": prompt}
    for name, ((voice_id, voice), text) in SPEECH.items():
        path = out / f"{name}.mp3"
        if not path.exists():
            print(f"  tale: {name}")
            path.write_bytes(_post(f"text-to-speech/{voice_id}", {"text": text, "model_id": TTS_MODEL}, key))
        manifest[name] = {"file": path.name, "kind": "speech", "voice": voice, "text": text}
    (out / "manifest.json").write_text(json.dumps({"source": "ElevenLabs (generert, syntetisk)", "sounds": manifest}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"skrev {len(manifest)} lyder til {out}")
