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
- ~~**`underwater-world v2`**: Komplette Refaktorierung in modulare `Biome/`/`Objekte/`/`Sinne/`/`welt/`-Struktur.~~
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
- **Performance-Wins (Commit `23fedb5`)** — Quest-72-Hz-Hot-Path:
  - ~~**`guidance.ts` allokationsfrei**: `TubeGeometry`/`BufferGeometry`/`Color` werden nicht mehr pro Frame neu erzeugt. Float32-Arrays vorab allokiert, in-place mutiert, parallel-transport-Frame in Scratch-Vektoren.~~
  - ~~**`scene.ts` Color-Pooling**: 7 geteilte `THREE.Color`-Instanzen (`_flashColor`, `_fishBaseColor`, drei Dome-Farben, `_coralIdleColor`) auf State. Eliminiert ~10× `new THREE.Color()` pro Frame.~~
  - ~~**City Domes**: `MeshPhysicalMaterial` → `MeshStandardMaterial` (kein Clearcoat-BRDF-Layer). Spart eine volle PBR-Berechnung pro Fragment auf großer transparenter Doppelseiten-Kuppel.~~
- **0 errors, 0 warnings** (biome + svelte-check).

### Ausstehend
- ~~Echoortung in die VR-Welt integrieren~~
- ~~Bugfix-Runde (Doppelbeleuchtung, Leaks, Settings, Crash)~~
- ~~Erste 3 Performance-Wins (Guidance / Color / Dome-Material)~~
- **Mittlere Performance-Items**: Seagrass → InstancedMesh, Water Surface → Shader, Fish-Echo-Update nur bei Delta
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

#### 2. ⚡ Mittlere Performance-Items (Quick Wins nach den 3 großen)

**a) Seagrass → InstancedMesh** (`Objekte/Seegras/seagrass.ts`)
- Aktuell: bis zu 220 separate `THREE.Mesh`-Objekte pro Patch × 10 sichtbare Patches = ~2.200 Meshes im Szenegraph, jeder mit eigener Draw Call
- Ziel: pro Seagrass-Typ eine `InstancedMesh` (Capacity = `count * maxPatches`), Sway-Update nur `instanceMatrix`
- Erwartet: drastische Draw-Call-Reduktion, weniger Three.js-Overhead pro Frame

**b) Water Surface → ShaderMaterial** (`welt/wasser.ts`)
- Aktuell: `MeshPhysicalMaterial` (roughness 0, metalness 0) + JS-update von `position.y` und `opacity` jeden Frame
- Ziel: `ShaderMaterial`/`RawShaderMaterial` mit Sinus-Wave im Vertex-Stage, `uTime` uniform
- Spart: GPU statt JS für Wellenberechnung, transparent-pass Sortier-Cost

**c) Fish-Echo: Color/Emissive nur bei Änderung setzen**
- Aktuell: `school.material.emissiveIntensity = sin(...)` wird jeden Frame neu gesetzt, auch ohne Echo-Event
- Ziel: dirty-flag, nur setzen wenn `|new - last| > epsilon`

**d) Sand-Entry Terrain-Höhe cachen**
- Aktuell: für jeden sand entry + start city jeden Frame `getTerrainHeight` (= 8 noise2d calls)
- Ziel: cachen, nur bei Spieler-Bewegung >50m oder Amplituden-Änderung neu berechnen

**e) `scene.traverse` in `applySettings` ersetzen**
- Aktuell: bei `lightIntensity`-Update ganze Szene traversiert
- Ziel: Lichtquellen einmalig in State referenzieren

#### 3. 🌊 Wasser-Shader / God Rays / Caustics
- Unterwasser-Lichtbrechung (Caustics auf Terrain/Korallen)
- God Rays vom Sonnenlicht
- Realistische Water-Waves via Shader (statt statischer Plane)

#### 4. 🐬 Delfin-Neuschreibung
- Eigenes Patrol, nicht an Spieler gebunden
- Kreise ziehen, auf-/abtauchen, Terrain-Folge
- Optional: Echoortung per Delfin-Klicklaute

#### 5. 🎯 Leitsystem verfeinern
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
| 4 | **Korallen-Flash** flutet alle Korallen gleichzeitig bei jedem Echo-Treffer | Nicht gefixt (durch Bug #1 verursacht) |
| 5 | **Seagrass 2.200+ Meshes** im Szenegraph | Optimierung geplant (Item 2a) |
| 6 | **`getTerrainHeight` jeden Frame** pro Sand-Entry (8 noise-calls) | Optimierung geplant (Item 2d) |

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

## Letzte Commits (für Kontext)

```
23fedb5 perf(underwater-world-v2): allocation-free per-frame hot paths
12c70c4 chore(deps): add three-mesh-bvh, update AGENTS_PLAN + architecture docs
894036e chore(assets): add underwater-world v2 model + audio assets
8ea73c2 feat(underwater-world-v2): restructure into Biome/Objekte/Sinne/welt modules
4c79c45 merge upstream/main: keep both underwater-world and visio-technologica experiences
b1d658a fix: NaN positions in coral geo, shared instanceColor buffer, AudioContext lazy init
983510e fix: doppelte Beleuchtung entfernt, 6 High-Priority Bugs gefixt
47dc15b Echoortung in VR-Welt integriert (Punkt 1)
947c134 AGENTS_PLAN: abgeschlossene Punkte durchgestrichen, v2-Fortschritt dokumentiert
```
