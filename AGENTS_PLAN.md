# 🧠 Agents Plan — Neural Flight VR

> KI-Zugriffsdatei: Bei Wiederaufnahme zuerst diese Datei lesen.

---

## Status (Juni 2026)

### Fertiggestellt
- ~~**Echoortung-Testseite** (`/test/echoortung`): 6 Varianten (scan, puls, welle, reflex, faecher, impuls)~~
- ~~**Reflex-Echo**: Jede Welle löst einmal Reflexion + Aufleuchten des Zielobjekts aus. Cooldown-Mechanismus durch `_reflexDone`-Flag pro Ring ersetzt.~~
- ~~**Fächer-Scan**: 5 Ringe im Fächer (Y-Rotation -0.3 bis +0.3) simulieren Delfin-Kopfdrehung.~~
- ~~**Impuls-Ton**: Ring pulsiert in Helligkeit + Größe (~7 Hz).~~
- ~~**3 Beispiel-Fische** auf der Testseite: grün/cyan/orange, reagieren mit Aufleuchten wenn Scan-Ring sie kreuzt.~~
- ~~**Korallenriff v2**: Beide Modelle (Garden 51MB + Kaleidoscope 89MB) via `scatterCoralModels`, SSR-Guard, `bminY`-Offset.~~
- ~~**Start City**: Dynamische Sand-Suche per Spiralscan, 3 Riff-Patches (nah/mittel/fern).~~
- ~~**Delfine & Quallen folgen Spieler** mit verzögertem Spawn (2s/5s).~~
- ~~**Kuppel-Repulsion** für Fische, Delfine, Quallen.~~
- ~~**Stadt-Modell**: `la_night_city.glb`, Kuppelradius 65m, fällt auf prozedurale Stadt zurück.~~
- ~~**`underwater-world v2`**: Komplette Refaktorierung in modulare `welt/`-Struktur.~~
- ~~**Leitsystem (`Sinne/Leitsystem/`)**: Neue Guidance-Komponente.~~
- ~~**Stadt-Spacing**: `CITY_SPACING_MIN = 150m`.~~
- ~~**Delfine & Quallen & CityGuidance aus v2 entfernt**.~~
- ~~**`getTerrainHeight`** nutzt jetzt `getBiomeParams`.~~
- ~~**Bugfix-Runde (Commit `983510e`)**:~~
  - ~~Doppelte Beleuchtung entfernt (Loader vs. scene.ts)~~
  - ~~Dead Code: `rebuildCoralInstances()` entfernt~~
  - ~~Memory-Leaks: `baseGeo` + `coralGeos` disposed~~
  - ~~Listener-Leak: `removeEventListener` in dispose()~~
  - ~~Settings: `lightIntensity` skaliert Lights, `terrainColor` färbt `terrainMat`~~
  - ~~Crash-Risiko: `boundingBox!` → `if(bb)` Guard~~
- **0 errors, 0 warnings** (biome + svelte-check).

### Ausstehend
- ~~Echoortung in die VR-Welt integrieren~~
- ~~Bugfix-Runde (Doppelbeleuchtung, Leaks, Settings, Crash)~~
- **Wasser-Shader / God Rays / Caustics**
- **Delfin-Neuschreibung** (wurden entfernt statt neu geschrieben)

### Nächste Schritte (geplant)

#### 1. 🐟 Echoortung: Fische nacheinander aufleuchten lassen (Bug)
**Ziel:** Fische sollen einzeln gelb aufblitzen, wenn der expandierende Ring sie wirklich berührt — nicht alle gleichzeitig.

**Root Cause:** `school.mesh.position` wird von `updateFishSchool` nie aktualisiert → bleibt immer (0,0,0). Alle 80 Fischschwärme melden Position 0 → Echo-System trifft sie alle im selben Frame.

**Fix war fertig, wurde auf User-Wunsch verworfen — muss neu gemacht werden:**
- `FishSchool.centroidX/centroidZ` hinzufügen, live in `updateFishSchool` berechnen
- `scene.ts` liest `school.centroidX/Z` statt `school.mesh.position`
- `FLASH_DURATION` 0.5s → 0.15s für sichtbare Welle

#### 2. 🌊 Wasser-Shader / God Rays / Caustics
- Unterwasser-Lichtbrechung (Caustics auf Terrain/Korallen)
- God Rays vom Sonnenlicht
- Realistische Water-Waves via Shader (statt statischer Plane)

#### 3. 🐬 Delfin-Neuschreibung
- Eigenes Patrol, nicht an Spieler gebunden
- Kreise ziehen, auf-/abtauchen, Terrain-Folge
- Optional: Echoortung per Delfin-Klicklaute

#### 4. 🎯 Leitsystem verfeinern
- Guidance-Linien-Bogen optimieren (Start 10m unter Spieler + Terrain-Clamp)
- Mehrere Städte: Guidance wechselt bei Ankunft (20m Radius) zur nächsten
- Optional: zweite Farbe für bereits besuchte Städte

---

## Bekannte Probleme (Bugs)

| # | Problem | Status |
|---|---------|--------|
| 1 | **Fische alle gleichzeitig** — `school.mesh.position` nie geupdated → (0,0,0) | Fix bereit, nicht committet |
| 2 | **Bekannte Probleme im Codebase** — siehe `AGENTS.md` Critical Context | Nicht angetastet |
| 3 | **`lightIntensity`-Slider** skaliert alle Szenen-Lichter (Ambient + Directional) proportional | Gefixt in `983510e` |
| 4 | **Korallen-Flash** flutet alle Korallen gleichzeitig bei jedem Echo-Treffer | Nicht gefixt |

## Offene Fragen
- Echoortung: Eigener System-Kanal oder direkt in `tick()` integrieren? → Aktuell in `tick()`.
- Sollen Delfine/Quallen/Haie zurück? Aktuell nur Fische + Städte als Ziele.
- Guidance: Soll es auch für Riffe/Korallenfelder geben?
- Fish-Echo: Nur Schul-Position oder jede Instanz einzeln scannen? (Performance vs. Genauigkeit)

## Wichtige Konstanten (für Wiederaufnahme)
| Konstante | Wert | Fundort |
|-----------|------|---------|
| CHUNK_SIZE | 400m | welt/chunks.ts |
| CHUNK_SEGMENTS | 48 | welt/terrain.ts |
| CORAL_STREAM_RADIUS | 300m | welt/chunks.ts |
| SAND_STREAM_PER_FRAME | 8 | Biome/Sand/sand.ts |
| SAND_PATCH_COUNT | 400 | Biome/Sand/sand.ts |
| CITY_SPACING_MIN | 150m | scene.ts |
| GUIDANCE_ARRIVAL_RADIUS | 20m | scene.ts |
| DOME_RADIUS | 65m | modelCity.ts |
| ECHO_RING_EXPAND_SPEED | 8m/s | echoortung.ts |
