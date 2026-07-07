# Underwater World V5 – Performance-Plan
das ganze ist als VR experience für den icaros Flugsimulator gedacht https://www.icaros.com/de/produkte/icaros-health man fliegt/schwimmt also durch die Unterwasser Welt. Man soll eine lebendige Unterwasser Welt mit Städten fischen, Quallen, korallen etc. erleben und dabei sich mit den sinnen der echo Ortung und des Städte Leitsystems zurecht finden in der welt. Es soll ein Szenario zeigen bei dem die menschen wegen Überbevölkerung sich neue Lebensräume wie das Meer erschließen und mit neuen sinnen sich in den neuen Lebensräumen zurecht finden, Performance ist dabei das aller wichtigste, keine Ruckler, alles smooth.
## Bereits umgesetzt

### 1. Geteiltes Seegras-Material (2026-07-08)
**`terrainChunk.ts` + `chunkManager.ts`**
- Vorher: 250+ individuelle TSL-Materialien (eines pro Halm)
- Nachher: **EIN geteiltes Material** `_sharedSeegrassMat` für alle Halme
- Shader wird nur einmal von der GPU kompiliert
- `_unloadChunk` disposet kein Material mehr (shared!)

### 2. Quadratische Distanzen (2026-07-08)
**`fishWorld.ts` + `jellyWorld.ts` + `cityWorld.ts`**
- `Math.sqrt()` nur noch im `if`-Block (wenn Distanz wirklich gebraucht wird)
- Vorher: sqrt bei jedem Fisch/Kuppel-Check pro Frame
- Spart hunderte sqrt-Aufrufe pro Frame
- CityWorld `_updateSlotState` bekommt `distSq` statt `dist`

### 3. Gestaffeltes Chunk-Laden (2026-07-08)
**`chunkManager.ts`**
- Vorher: Alle 5 neuen Chunks in einem Frame geladen → Ruckler
- Nachher: **Max 4 Chunks pro Frame** – Warteschlange bleibt erhalten (wird nicht geleert)
- WFC-Callbacks werden gestaffelt ausgelöst
- Verhindert, dass Chunks nie geladen werden, wenn der Spieler sich bewegt

### 4. Echoortung-Fix (2026-07-08)
**`jellyWorld.ts`**
- Vorher: `_hasActiveGlow`-Guard verhinderte Glow bei Quallen
- Nachher: Glow wird immer verarbeitet, `_hasActiveGlow` nur als Rückmelde-Flag

### 5. Boden-Ring vergrößert + folgt Spieler (2026-07-08)
**`chunkManager.ts`**
- Ring-Radius von ~34m auf **100m** vergrößert (keine sichtbare Kante mehr)
- Ring folgt dem Spieler wieder (position.set pro Frame), weil 100m + Nebel kaschiert die sanfte Verschiebung
- Dünen-Höhen werden beim Bau in Welt-Koordinaten eingebacken

### 6. Städte vorbereiten (2026-07-08)
**`cityWorld.ts`**
- `_buildCityGroup()` in `_makeReady()` (bei ~65m) statt `_showCity()` (bei ~40m)
- Schwere Arbeit (Klon, Box3, Kuppel, Lichter) passiert ~12s vor Sichtbarkeit
- `_showCity()` macht nur noch `scene.add()`

### 7. Korallen vorbereiten (2026-07-08)
**`coralReefWorld.ts`**
- `_prepareReef()` bei ~70m (Korallen klonen, platzieren)
- `_showReef()` bei ~60m (nur `scene.add()`) → kein Ruckeln mehr beim Erscheinen
- `_removeReefByIndex`: Entfernung bei >80m statt 70m (mehr Puffer)

### 8. Fische & Quallen weiter weg spawnen (2026-07-08)
**`fishWorld.ts` + `jellyWorld.ts`**
- Vorher: Fische in 15-35m, Quallen in 15-25m – plötzlich vor der Nase
- Nachher: Beide in **50-65m** Distanz – schwimmen von selbst näher

### 9. renderDistance reduziert (2026-07-08)
**`scene.ts`**
- `renderDistance: 2` → `1` → 3×3=9 Chunks statt 5×5=25
- Nebel kaschiert die reduzierte Sichtweite

### 10. Echoortung optimiert (2026-07-08)
**`echolocationRings.ts` + `fishWorld.ts`**
- Kollisions-Check nur **alle 3 Frames** (Ring bewegt sich nur 0.13m/Frame)
- **Distanz-Vorfilter**: Nur Targets im aktiven Ringbereich prüfen (spart ~80%)
- **Nur sichtbare Fische** als Targets (nicht alle 12)
- **32 Segmente** statt 64 für Ring-Geometrie
- `ringInterval: 5s` (ein Ring reicht)

### 11. Quallen-Pool (2026-07-08)
**`jellyWorld.ts` + `proceduralJelly.ts`**
- `cloneJelly()` in proceduralJelly.ts – klont eine Qualle OHNE neue Geometrie/Materialien
- Pool von 9 Quallen wird in `init()` einmal mit `buildMoonJelly()` befüllt
- `_spawnGroup` klont nur noch aus dem Pool → kein Ruckeln mehr
- `_removeGroup` disposed nicht mehr → Quallen bleiben im Pool

### 12. School-Pool (2026-07-08)
**`fishWorld.ts`**
- 2 InstancedMeshes werden in `init()` vorab erstellt
- `_spawnSchool` nimmt Pool-Mesh statt `new InstancedMesh()`
- Beim Despawn wird Mesh in Pool zurückgelegt (`visible = false`)
- Kein `dispose()` + `scene.remove()` mehr im Tick

## Performance-Regeln

- **Kein `new THREE.Color()` / `.clone()` im Frame-Loop**
- **Kein `scene.traverse` im Frame-Loop** (Blocking)
- **Kein `new InstancedMesh` oder `buildMoonJelly` im Tick** (Pool nutzen)
- Schwere Operationen zeitlich vor Sichtbarkeit ausführen (Puffer nutzen)
- Wiederverwendbare Vektoren/Matrizen als Klassen-Felder vorhalten
