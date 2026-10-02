# deutschland-familie

„Deutsche Familien“: Relief Deutschlands mit allen 16 Ländern, ihren Wappen, Farben und Wahrzeichen. Statische Seite, ausgeliefert über Cloudflare Workers (Static Assets), aufgebaut wie [swiss-family](https://github.com/hartmann-account/swiss-family).

Wer ein Land wählt (Kachel, Klick ins Relief oder Link wie `/#by`), bekommt die Seite in den Farben dieses Landes: Band, Akzente, Landesumriss und Modellsockel wechseln, die Kamera fliegt hin, die Wahrzeichen erscheinen im Relief.

```sh
npm install
npm run dev      # lokal unter http://localhost:8787
npm run deploy   # nach Cloudflare deployen
```

Jeder Push auf `main` geht über die Git-Anbindung von Cloudflare direkt live.

## Aufbau

- `public/index.html`: Seite und Stil
- `public/laender.js`: Länder mit Namen, Landeshauptstadt, Farben und Wahrzeichen-Texten
- `public/app.js`: Relief (three.js), Kamerafahrt, Beschriftungen, Landeswahl
- `public/data/`: Höhenraster, Schummerung, Ländermaske, Linien und Orte (aus `tools/build_data.py`), Wappen
- `tools/build_data.py`: erzeugt `public/data` aus den Rohdaten; `tools/places.json` enthält Wahrzeichen, höchste Punkte, Gipfel und Seen in UTM 32N mit Quellenangaben

Daten neu erzeugen (Python 3 mit numpy, scipy, geopandas, rasterio, shapely, pillow, scikit-image):

```sh
mkdir raw   # Rohdaten hier entpacken, siehe unten
RAW=raw python3 tools/build_data.py
```

## Datenlage im Vergleich zur Schweiz

| Zweck | Schweiz (swiss-family) | Deutschland (hier) |
|---|---|---|
| Höhenmodell | swissALTIRegio, 10 m, offen | DGM200 des BKG, 200 m, offen. Das bundesweit zusammengeführte DGM1 stellt das BKG nur berechtigten Stellen zur Verfügung (der Dienst antwortet sonst mit „NOACCESS_SERVICE“). Einzelne Länder, etwa Nordrhein-Westfalen, Berlin und Hamburg, geben ihr DGM1 getrennt als Open Data ab. |
| Grenzen, Flächen, Einwohner | swissBOUNDARIES3D | VG250-EW, Stand 31.12.2024: Länder, Kreise, Gemeinden, Katasterflächen, Einwohnerzahlen |
| Gewässer, Wald | swissTLMRegio | DLM250 |
| Namen, Gipfelhöhen | swissNAMES3D | GN250 (amtliche Höhenpunkte) |
| Nachbarländer | im Höhenmodell enthalten | Copernicus DEM GLO-90; Küstenlinie aus dessen Meeresfläche (Höhe 0), Seen aus Natural Earth |

Alle BKG-Produkte stehen unter der Datenlizenz Deutschland – Namensnennung – Version 2.0. Eurostat GISCO wird nicht verwendet, weil die Grenzdaten von EuroGeographics nur nichtkommerziell genutzt werden dürfen.

Die Auflösung ist gröber als in der Schweiz: Das Relief mittelt DGM200 auf 600 m (Schweiz: swissALTIRegio auf 250 m). Die höchsten Punkte der Länder stammen deshalb nicht aus dem Raster, sondern aus amtlichen Angaben (GN250, Landesvermessung), siehe `tools/places.json`.

## Rohdaten

Download unter https://daten.gdz.bkg.bund.de/produkte/ (BKG) und https://copernicus-dem-90m.s3.amazonaws.com/ (Copernicus):

- `vg/vg250-ew_ebenen_1231/aktuell/vg250-ew_12-31.utm32s.gpkg.ebenen.zip`
- `dlm/dlm250/aktuell/dlm250.utm32s.shape.ebenen.zip`
- `dgm/dgm200/aktuell/dgm200.utm32s.geotiff.zip`
- `sonstige/gn250/aktuell/gn250.utm32s.csv.zip`
- Copernicus GLO-90, Kacheln `Copernicus_DSM_COG_30_N46_00_E005_00_DEM` bis `N55_00_E015_00` (fehlende Kacheln sind offenes Meer)
- Natural Earth `ne_10m_lakes` und `ne_10m_lakes_europe`

## Quellen

Höhenmodell DGM200 und Landschaftsmodell DLM250: © GeoBasis-DE / BKG (2026) dl-de/by-2-0 (Daten verändert). VG250-EW und GN250: © BKG (2026) dl-de/by-2-0 (Daten verändert), Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf und https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_gn250.pdf.

Außerhalb Deutschlands: produced using Copernicus WorldDEM™-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. Seen der Nachbarländer: Natural Earth (gemeinfrei).

Wappen: Wikimedia Commons, Lizenzen in `public/data/wappen/LIZENZEN.md`. Landeswappen sind Hoheitszeichen; die Seite zeigt sie nur zur Information und ist keine offizielle Seite des Bundes oder der Länder.
