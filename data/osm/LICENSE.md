# Lisens for data/osm/

Filene i denne mappa er bygningsomriss hentet fra OpenStreetMap og forenklet (se
`pipeline/src/flypipe/osm.py`).

© OpenStreetMap contributors. Dataene er tilgjengelige under Open Database License (ODbL) 1.0:
https://opendatacommons.org/licenses/odbl/1-0/ · https://www.openstreetmap.org/copyright

Det som lages av disse filene (`buildings.bin` og bygningscellene i `structures.json` i flisene for
utsnitt med `osm_footprints`) er en avledet database og deles under samme lisens. Resten av prosjektet
har andre vilkår, se `LICENSE` i roten.

Omrissene i OpenStreetMap er ifølge OSM-wikien importert fra Kartverkets «INSPIRE Buildings Core2D»
(CC BY 4.0). Bygningstype og høyde i flisene kommer ikke fra OpenStreetMap, men fra Kartverket
(Matrikkelen og høydemodellen, CC BY 4.0).
