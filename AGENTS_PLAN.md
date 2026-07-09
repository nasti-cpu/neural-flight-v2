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
- **4. Stadt-Variante `Kolonie`** (`Biome/Städte/city.ts`) — biomorphes Unterwasser-Habitat inspiriert von Conshelf/Tektite/Aquarius/SeaOrbiter/Rougeries Galathée. Hauptkörper + 6 Pods + 4 Pylone + Sensor-Mast. Reine Mesh-Komposition, kein InstancedMesh.
- **Städte-Testseite** (`/test/staedte`) — 4 Buttons (altstadt/zentrum/vorort/kolonie), unabhängige WebGLRenderer-Szene, Kamera (0, 45, 110).
- **Stadt-Zufallspick** in der VR-Experience: Start-City und Sand-Entry-Cities = zufällig `altstadt` oder `vorort` (50/50). Kein Model-City mehr im canonical Pfad.
- **Start-City Position**: Spiralscan ab (0, -150), Range 0–180m → 100–180m vom Spawn entfernt. +2.0m Y-Offset damit die Stadt nicht im Boden sitzt.
- **`modelCity.ts` SSR-Fix**: `_loadGLB()` short-circuited in Node (`window === undefined`), `ensureModelLoaded()` startet lazy. Verhindert "Failed to parse URL" Crash bei SSR.
- **0 errors, 0 warnings** (biome + svelte-check).
- **Bug #1 Fix: Fische blitzen einzeln auf** (Commit `4047dad`) — `FishSchool.centroidX/Y/Z` wird in `updateFishSchool` live als `mesh.position + mean(local positions)` berechnet. `scene.ts` Echo-Targets lesen `school.centroidX/Z` statt `school.mesh.position`. `FLASH_DURATION` 0.5s → 0.15s damit Flashes zwischen Ring-Sweeps sauber abklingen. Behebt Bug #1 + Bug #4 (Korallen-Flash-Cascade).
- **Bug #7 Fix: Fische-Jitter in VR** — Fische folgen nun dem Spieler mit gedämpftem `lerp` und ignorieren Kopf-Pitch/Roll (nur Yaw wird für Ankerpunkt genutzt). Verhindert "Mitschwingen" bei Kopfdrehungen.
- **Bug #8 Fix: Controller im VR** — `updatePlayer` implementiert und Kamera-Rig eingeführt. Ermöglicht Steuerung via Pitch/Roll-Controller in VR (Kamera-Elternobjekt wird bewegt, damit Headset-Tracking die Simulation nicht überschreibt).
- **Korallen-Modelle deaktiviert** (Commit `f1fc2de`) — Feature-Flag `ENABLE_MODEL_CORALS = false` in `Biome/Korallenriff/modelCoralReef.ts`. Spart **~140MB** VRAM+Netzwerk (Garden 51MB + Kaleidoscope 89MB GLB). Prozeduraler `createCoralReef`-Fallback läuft automatisch. Re-Aktivierung = 1 Zeile auf `true` + ggf. `git restore` der GLBs aus static/models/.
- **Fisch-Farben dunkler** (Teil von Commit `4047dad`) — `FISH_COLORS` mit Faktor 0.45 multipliziert (8x Farben). Besserer Kontrast zur Wasser-Atmosphäre, weniger "Leuchten aus dem Wasser".
- **Seagrass → InstancedMesh (Item 2a)** (Commit `ffd5f75`) — 3 geteilte `InstancedMesh` (algae/long/bushy) ersetzen ~2.200 separate Meshes. Slot-System (max 12 meadows/type). `DynamicDrawUsage`, `initSeagrassSystem()`, `updateSeagrassSway()` schreibt direkt `instanceMatrix`. Test-Seite (`/test/seegras`) angepasst.
- **VR-Controller + Kamera-Rig (Bugs #7, #8)** (Commit `ffd5f75`) — `updatePlayer` liest Pitch/Roll/Speed vom Controller und steuert das neue Kamera-Rig (`THREE.Group` als `camera`-Parent). Fische folgen gedämpftem `fishYaw` + `fishFollowPos` statt rohem Headset-Pose. Auto-drift nutzt `getWorldQuaternion` für korrekte kombinierte Orientierung.
- **Float-Speed Boost** (Commit `2cd4c03`) — Basis-Drift 2→4 m/s, Space-Boost Max 20→30, WASD 6→10, sanfterer Decay nach Boost (min 4 statt 1.5).
- **Sand-Dünen organisch** (Commit `13e8ac1`) — Radialer Smoothstep-Edge-Falloff (10m Zone), Höhe fades weich zu 0 an den Rändern. Dünen matchen Terrain-Amplitude/Scale. Keine harten Quadrat-Kanten mehr.
- **Seagrass-InstancedMesh-Fix** (Commit `2ce5283`) — `writeMeadowMatrices()` sofort nach `createSeagrassMeadow` aufgerufen. Blades vorher unsichtbar bis zum ersten Sway-Frame (alle Instanzen bei scale:0).
- **Biome-Verteilung dichter** (Commit `9e21a9b`) — Seegras 40→50%, Riff 20→30%, SAND_PATCH_COUNT 400→600. 50% mehr Patches, 80% Flora.
- **Test-Seite Seegras** (Commits `6f5ee7c`, `2a7d89c`) — 3 Skalierungs-Fische (klein/mittel/groß) zum Größenvergleich, GLTF-Modell wie in VR v2.
- **Sand-Streaming-Fix (Bug #9)** (Commits `6f136cb`, `cd6d1fb`) — Root Cause: `hash2d`-Positionen über ±1400m, 0 innerhalb 350m vom Spawn → kein Seegras. Fix: Cap 10→30, Init-Radius 200→350, Stream-Rate 8→16 + Grid-Scan 40m-Raster ±400m um Spawn (65% Seegras).

### Ausstehend
- ~~Echoortung in die VR-Welt integrieren~~
- ~~Bugfix-Runde (Doppelbeleuchtung, Leaks, Settings, Crash)~~
- ~~Erste 3 Performance-Wins (Guidance / Color / Dome-Material)~~
- ~~Seagrass → InstancedMesh~~
- **Water Surface → ShaderMaterial** (Item 2b)
- **Fish-Echo dirty-flag** (Item 2c)
- **Sand-Entry Terrain cachen** (Item 2d)
- **`scene.traverse` in `applySettings` ersetzen** (Item 2e)
- **Wasser-Shader / God Rays / Caustics**
- **Delfin-Neuschreibung** (wurden entfernt statt neu geschrieben)

### Nächste Schritte (geplant)

#### 1. ~~🐟 Echoortung: Fische nacheinander aufleuchten lassen (Bug)~~
~~**Ziel:** Fische sollen einzeln gelb aufblitzen, wenn der expandierende Ring sie wirklich berührt — nicht alle gleichzeitig.~~

~~**Root Cause:** `school.mesh.position` wurde von `updateFishSchool` zwar gesetzt, aber `scene.ts` Echo-Targets nutzten den **InstancedMesh-Anker** (= Spawn-Punkt hinter dem Spieler), nicht den **tatsächlichen Schwarm-Centroid**. Fische schwimmen im 30-50m Spread um den Anker → Ring traf alle 3 Schulen nacheinander an Spawn-Positionen. `FLASH_DURATION=0.5s` ≈ Ring-Intervall → wahrgenommener "alle-gleichzeitig"-Glow.~~

~~**Fix (Commit `4047dad`):**~~
- ~~`FishSchool.centroidX/Y/Z` hinzugefügt, live in `updateFishSchool` als `mesh.position + mean(local positions)` berechnet~~
- ~~`scene.ts` liest `school.centroidX/Z` statt `school.mesh.position`~~
- ~~`FLASH_DURATION` 0.5s → 0.15s für sichtbare Einzel-Flashes~~

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
| 1 | **Fische alle gleichzeitig** — `scene.ts` Echo-Targets nutzten Mesh-Anker statt Schwarm-Centroid | **Gefixt in `4047dad`** |
| 2 | **Bekannte Probleme im Codebase** — siehe `AGENTS.md` Critical Context | Nicht angetastet |
| 3 | **`lightIntensity`-Slider** skaliert alle Szenen-Lichter (Ambient + Directional) proportional | Gefixt in `983510e` |
| 4 | **Korallen-Flash** flutet alle Korallen gleichzeitig bei jedem Echo-Treffer | **Gefixt in `4047dad`** (Cascade-Fix von Bug #1) |
| 5 | **Seagrass 2.200+ Meshes** im Szenegraph | **Gefixt in `ffd5f75`** (InstancedMesh) |
| 6 | **`getTerrainHeight` jeden Frame** pro Sand-Entry (8 noise-calls) | Optimierung geplant (Item 2d) |
| 7 | **Fische-Jitter in VR** — Fische schwingen bei Kopfdrehung mit | **Gefixt in `ffd5f75`** (fishYaw/fishFollowPos Lerp) |
| 8 | **Kein Controller-Support im VR** — `updatePlayer` war leer | **Gefixt in `ffd5f75`** (Pitch→Vertikal, Roll→Yaw via Rig) |
| 9 | **Seegras unsichtbar in VR** — 0 Sand-Patches innerhalb 350m vom Spawn (hash2d-Verteilung) | **Gefixt in `cd6d1fb`** (Grid-Scan + Cap/Radius-Erhöhung) |

## Offene Fragen
- Echoortung: Eigener System-Kanal oder direkt in `tick()` integrieren? → Aktuell in `tick()`.
- Sollen Delfine/Quallen/Haie zurück? Aktuell nur Fische + Städte als Ziele.
- Guidance: Soll es auch für Riffe/Korallenfelder geben?
- Fish-Echo: Nur Schul-Position oder jede Instanz einzeln scannen? (Performance vs. Genauigkeit)

## Wichtige Konstanten (für Wiederaufnahme)
| Konstante | Wert | Fundort |
|-----------|------|---------|
| CHUNK_SIZE | 400m | welt/terrain.ts |
| CHUNK_SEGMENTS | 48 | welt/terrain.ts |
| CORAL_STREAM_RADIUS | 300m | welt/chunks.ts |
| SAND_STREAM_PER_FRAME | 16 | scene.ts |
| SAND_PATCH_COUNT | 600 | scene.ts |
| STREAM_INIT_RADIUS | 350m | scene.ts |
| SAND_ENTRY_CAP | 30 | scene.ts |
| SPAWN_SCAN_RADIUS | 400m | scene.ts |
| DUNE_FALLOFF_ZONE | 10m | Biome/Sand/sand.ts |
| DRIFT_SPEED_BASE | 4 m/s | scene.ts |
| DRIFT_SPEED_MAX | 30 m/s | scene.ts |
| WASD_SPEED | 10 m/s | scene.ts |
| CITY_SPACING_MIN | 150m | scene.ts |
| GUIDANCE_ARRIVAL_RADIUS | 20m | scene.ts |
| DOME_RADIUS | 65m | Biome/Städte/city.ts |
| ECHO_RING_EXPAND_SPEED | 8m/s | echoVRIntegration.ts |
| START_CITY_SPIRAL_CENTER | (0, -150) | scene.ts |
| START_CITY_SPIRAL_RANGE | 180m | scene.ts |
| START_CITY_SPIRAL_STEP | 10m | scene.ts |
| START_CITY_Y_OFFSET | +2.0m | scene.ts |
| CITY_VARIANTS_IN_VR | `altstadt` \| `vorort` (50/50) | scene.ts |
| CITY_VARIANTS_IN_TEST | `altstadt` \| `zentrum` \| `vorort` \| `kolonie` | test/staedte/+page.svelte |
| ECHO_RING_POOL_SIZE | 40 | echoVRIntegration.ts |
| ECHO_RING_LIFETIME | 3s | echoVRIntegration.ts |
| COLONY_MAIN_HULL_LENGTH | 32m | Biome/Städte/city.ts |
| COLONY_POD_RING_RADIUS | 22m | Biome/Städte/city.ts |
| COLONY_POD_COUNT | 6 | Biome/Städte/city.ts |
| COLONY_PYLON_COUNT | 4 | Biome/Städte/city.ts |
| WATER_SURFACE_Y | 500 | welt/wasser.ts |
| FOG_NEAR/FAR | 10 / 180 | manifest.ts (loader) |

## Letzte Commits (für Kontext)

```
cd6d1fb fix(sand): grid-scan 400m around spawn to guarantee seagrass near player — random hash2d left gaps
f8d0b3a debug(seagrass): add setup + stream entrypoint logs to trace why meadows don't spawn
87a5b8a debug(seagrass): add console logs to trace meadow creation in VR experience
6f136cb fix(sand): increase active cap 10→30, init radius 200→350, stream/frame 8→16 — seagrass was barely spawning
2a7d89c fix(test/seegras): use GLTF fish model (same as VR v2), procedural fallback
6f5ee7c feat(test/seegras): add 3 scale-reference fish (small/medium/large) for size comparison
9e21a9b feat(biome): increase seagrass 40→50%, reef 20→30%, patches 400→600 for denser flora
2ce5283 fix(seagrass): write instance matrices on creation — blades were invisible until first sway frame
13e8ac1 feat(sand): organic dune blending — radial smoothstep edge falloff, match terrain amp/scale
2cd4c03 feat(speed): boost float speed — base 2→4 m/s, max 20→30, wasd 6→10, gentler decay after boost
d81f191 docs(AGENTS_PLAN): mark Seagrass (2a), Bug #7, #8 as done; bump open tasks
ffd5f75 perf(seagrass): InstancedMesh slot-based (Item 2a) + fix(player): VR controller steering (Bug #8) + fix(fish): damped follow prevents VR jitter (Bug #7)
105b841 docs(AGENTS_PLAN): sync with bug #1 fix + coral disable + fish colors
f1fc2de feat(coral): add ENABLE_MODEL_CORALS flag, default off
4047dad fix(fish-echo): use live world-space centroid for per-school flash
```

---

## Resume-Instructions für eine neue KI-Session

Wenn diese Datei gelesen wird, um eine neue Session zu starten:

### Sofort prüfen
1. `bun install` ausgeführt? (Lockfile ist `bun.lock`)
2. `git log --oneline -15` — die letzten Commits sind die "working set"
3. `git status` — sollte clean sein (außer `tmp_dev_*.txt` Dev-Logs)
4. `bunx svelte-check --threshold error` — muss 0/0 sein
5. `bunx biome check .` — sollte clean sein

### Dev-Server starten
```bash
bun run dev
# HTTPS-Warnung im Browser wegklicken (Zertifikat-Problematik, siehe 894036e)
# Oder mit mkcert sauber einrichten (siehe AGENTS_PLAN oben)
```

### Aktive Branches
- `underwater-world-v2` (working branch) — hat alle aktuellen Änderungen
- `main` — 25 Commits hinter `origin/main`, lokaler Stand vom merge-upstream

### Wo der Code wohnt
- **Active experience**: `src/lib/experiences/underwater-world v2/`
- **Test pages**: `src/routes/test/{staedte,fische,haie,...}/+page.svelte`
- **Main VR scene**: `src/routes/vr/+page.svelte`
- **Controller UI**: `src/routes/controller/`
- **Shared 3D primitives**: `src/lib/three/`
- **WebSocket bridge**: `src/lib/ws/`

### Konventionen
- Tabs for indentation, double quotes for strings, semicolons required
- All Three.js allocations for hot paths go in module-level scratch objects
- Materials: prefer `MeshStandardMaterial` over `MeshPhysicalMaterial` unless you need clearcoat/iridescence
- Per-frame updates: avoid `new` for `THREE.*`, `Geometry`, `Color` etc.
- All hot paths validated by `bunx svelte-check` + `bunx biome check`
- `config/flight.ts` is the source of truth for tuning values
- Don't add dependencies without researching first; check existing ones

### Aktuelle offene Tasks (sortiert nach Impact)
1. **Water Surface → ShaderMaterial** (Item 2b) — GPU statt JS für Wellen
2. **Fish-Echo: dirty-flag** (Item 2c) — nur setzen wenn Wert sich ändert
3. **Sand-Entry Terrain cachen** (Item 2d) — 8 noise-calls/frame sparen
4. **`scene.traverse` in `applySettings` ersetzen** (Item 2e) — Lichtquellen direkt referenzieren
5. **Wasser-Shader / God Rays / Caustics** (Item 3) — visuelles Upgrade
6. **Delfin-Neuschreibung** (Item 4) — zurück ins Spiel
7. **Debug-Logs entfernen** — `[SEAGRASS]` Console-Logs aus `scene.ts` + `seagrass.ts` nach Bestätigung des Fixes

### Quick Context: was funktioniert bereits
- ✅ 4 Stadt-Varianten prozedural in `Biome/Städte/city.ts`
- ✅ Test-Seite `/test/staedte` mit allen 4 Buttons
- ✅ VR-Experience: prozedurale Städte (kein GLB-Download mehr), 100-180m vom Spawn
- ✅ Echoortung in VR integriert mit per-Schwarm-Tracking (Bug #1 Fix in `4047dad`)
- ✅ Performance: guidance allokationsfrei, scene.ts Color-Pooling, dome ohne clearcoat, Seagrass → InstancedMesh
- ✅ Korallen-Modelle deaktiviert (~140MB gespart): `ENABLE_MODEL_CORALS = false` → prozeduraler Riff-Fallback läuft
- ✅ VR-Controller-Steuerung via Kamera-Rig, Fische gedämpft (kein Headset-Jitter mehr)
- ✅ Schnelleres Floating (4 m/s Basis, 30 m/s Boost, WASD 10 m/s)
- ✅ Sand-Dünen mit weichem Edge-Falloff, matchen Terrain-Amplitude
- ✅ Seegras-Streaming: Grid-Scan garantiert Patches ≤400m vom Spawn, 80% Flora (50% Seegras + 30% Riff)

### Was der User typischerweise will
- Mehr Polish (Wasser, Lighting, Sound)
- Bessere Performance (s.o. Items 2b-2e)
- Neue Kreaturen / Biome
- VR-Tests auf der echten Quest-Brille
- Manchmal: einfach Commit + Push zum feature branch
