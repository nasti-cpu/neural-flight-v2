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
- **`underwater-world v2`**: Komplette Refaktorierung in modulare `welt/`-Struktur (terrain.ts, chunks.ts, wasser.ts). Korallen-Streaming auf Slot-Tracking umgestellt.
- **Leitsystem (`Sinne/Leitsystem/`)**: Neue Guidance-Komponente — eine Linie zur nächsten unbesuchten Stadt, inklusive:
  - Core Line + Glow Tube + Partikel-Pfeile (→-Canvas-Textur)
  - Wandernder Helligkeits-Puls auf der Linie (vertexColors)
  - Pfeile rotieren entlang Kurventangente zur Stadt
- **Stadt-Spacing**: `CITY_SPACING_MIN = 150m`, neue City-Varianten werden bei <150m Distanz auf Seagrass/Reef/Plain umgeworfen.
- **Delfine & Quallen & CityGuidance aus v2 entfernt** — zugunsten von einfachem, fokussiertem Leitsystem.
- **`getTerrainHeight`** nutzt jetzt `getBiomeParams` → exakte Höhen-Berechnung wie echtes Terrain.
- **0 errors, 0 warnings** (biome + svelte-check).

### Ausstehend (nicht angetastet)
- ~~Echoortung in die VR-Welt integrieren~~ **(erledigt)**
- Wasser-Shader / God Rays / Caustics
- Delfin-Neuschreibung (wurden entfernt statt neu geschrieben)

### Nächste Schritte (geplant)

#### 1. 🌍 Welt-Landschaft (`src/lib/experiences/unterwasser v2/welt/`)
~~Ziel: Landschafts-Code aus `scene.ts` auslagern und systematisch verbessern.~~

~~- **Ordner `welt/` anlegen** mit:~~
  ~~- `terrain.ts` — Geländegenerierung (FBM 4 Oktaven, Biome)~~
  ~~- `wasser.ts` — Wasseroberfläche (Y=75)~~
  ~~- `chunks.ts` — Streaming (3×3 Grid, directional 400m/120m)~~

Grundstruktur ist erledigt. Offene Verbesserungen:
- Realistischeres Wasser (Shader-Wellen, LOD)
- Terrains smooth transitions zwischen Chunks
- Unterwasser-Licht (God Rays, Caustics)
- Biomes: Übergänge weicher machen (aktuell smoothstep, okay)

#### 2. 🐬 Delfine neu schreiben (`Objekte/Delfine/`)
~~Ziel: Eigenständiges, natürliches Schwimmverhalten — nicht mehr am Spieler „kleben".~~

~~- **Komplett neuer `dolphin.ts`**~~
~~- Eigene Patrol-Logik~~
~~- Schwimm-Muster: Kreise ziehen, auf- und abtauchen~~
~~- Terrain-Folge~~

**Entfernt statt neugeschrieben.** Delfine wurden rausgenommen — das Leitsystem (Guidance) übernimmt die Orientierung. Falls Delfine zurückkommen sollen, muss ein neuer Ansatz her (nicht an Spieler gebunden, eigenes Patrol).

#### 3. 🔊 Echoortung in die Welt integrieren
Ziel: Scan-Echo-Ringe aus der Testseite in die VR-Welt einbauen. **Erledigt.**

- ✅ `echoVRIntegration.ts` erstellt — kapselt Echo-System + Flash-Management
- ✅ `scene.ts` — Echo in setup/tick/dispose integriert
- ✅ Scan-Ring wird alle 3s (konfigurierbar) vom Spieler ausgesendet
- ✅ **Objektreaktionen** bei Ringberührung:
  - Fische → `emissiveIntensity` * (1 + 3× Flash-Faktor)
  - Städte (modelCity + City) → `domeMat.emissiveIntensity` +0.6 Boost
  - Korallen (CoralField) → flächenhaftes Glühen wenn Ring aktiv ist
  - Start-City → gleicher Flash wie andere Städte
- ✅ Q-Taste zum Ein-/Ausschalten
- ✅ Settings: echolocationEnabled, echolocationRange, echolocationInterval
- ✅ 0 errors, 0 warnings (biome + svelte-check)

**Nicht implementiert (für später):**
- Gelände-Highlight (komplex, viele Vertices)
- Riff-Modell-Korallen (scatterCoralModels) — viele individuelle Meshes
- Delfin-Neuschreibung (separater Punkt)

#### 4. 🎯 Leitsystem verfeinern
- Guidance-Linien-Bogen optimieren (Start 10m unter Spieler + Terrain-Clamp)
- Mehrere Städte: Guidance wechselt bei Ankunft (20m Radius) zur nächsten
- Optional: zweite Farbe für bereits besuchte Städte

---

## Offene Fragen
- Echoortung: Eigener System-Kanal oder direkt in `tick()` integrieren?
- Sollen Delfine/Quallen/Haie zurück? Aktuell nur Fische + Städte als Ziele.
- Guidance: Soll es auch für Riffe/Korallenfelder geben?

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
