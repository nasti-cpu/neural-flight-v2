# Experiment 12 — Tiefsee-Unterwasserwelt: Plan & Status

## ✅ Erledigt

### 1. Grundstruktur
- [x] `createWorldState()` / `updateWorld()` / `destroyWorld()` in `underwaterWorld.ts` exportiert
- [x] Experience-Ordner `src/lib/experiences/experiment-12/` mit `index.ts`, `manifest.ts`, `scene.ts`
- [x] In `catalog.ts` registriert
- [x] TypeScript-Check fehlerfrei

### 2. ICAROS-Controller-Steuerung
- [x] `updatePlayer()` in `underwaterWorld.ts` — Pitch→tauchen, Roll→kurven, Accelerate/Brake
- [x] Konstant-Float (Unterwasserströmung) immer aktiv
- [x] Float-Geschwindigkeit reduziert (0.25× moveSpeed ≈ 2 u/s)
- [x] Manifest: `interfaces: { orientation: true, speed: true }`

### 3. Sichtweite & Nebel
- [x] Fog-Farbe = Background (`#000814`) — keine sichtbare Naht
- [x] `cameraFar`: 45 → 80 — Clip liegt weit hinter Chunks
- [x] Fog-Bereich verdoppelt: dynamisch 4–24 (Boden) bis 12–64 (Oberfläche)
- [x] Manifest-Werte同步

### 4. Städte (Pop-In, Abstand, Fade)
- [x] Einblendbereich vergrößert: `DIST_SHOW` 22→40, `DIST_FULL_OPACITY` 14→25
- [x] Lerp-Faktor 5.0→2.5 — langsamerer, weicherer Übergang
- [x] Raster-Abstand 80→120 — Städte haben mindestens 80 m Abstand
- [x] `DIST_FULL_OPACITY` 10→25 — Stadt fade-t nicht mehr während man drin ist
- [x] Raster-Slot (0,0) übersprungen — Spieler startet nicht in einer Stadt

---

## 🔄 Offen / Potenzielle Folge-Probleme

### 5. Korallenriffe: kein Fade-Out
- **Problem:** `CoralReefWorld` hat nur Fade-In (opacity steigt von 0→1), aber **kein Fade-Out** — beim Verlassen wird die Gruppe sofort aus der Szene entfernt.
- **Fix:** `_hideReef` müsste einen sanften Opazität-Rücklauf bekommen, analog zu `_showReef`.

### 6. Seegras (Chunks): kein Fade
- **Problem:** `ChunkManager` lädt/entladt Chunks (Seegras) **sofort ohne Fade**. Das erzeugt Pop-In beim Überqueren von Chunk-Grenzen.
- **Fix:** Seegras müsste ebenfalls einen Opazität-Übergang bekommen oder das Chunk-Manager-Update müsste verzögert werden.

### 7. Kamera-Rotation in VR
- **Problem:** `updatePlayer()` setzt `camera.rotation.set(...)`. Im VR-Modus überschreibt das XR-System die Rotation, also kein Konflikt. Aber im Non-VR-Modus wird die Rotation gesetzt — das könnte mit anderen Quellen (PointerLock, Maus) kollidieren, falls der standalone-Pfad je auf den Controller umgestellt wird.
- **Offen:** aktuell kein Konflikt, aber bei Erweiterung beachten.

### 8. Standalone-Testseite (`/test/experiment-12`)
- **Problem:** Die Testseite nutzt weiterhin `initWorld()` / `disposeWorld()`. Der Code wurde refaktorisiert (delegiert an `createWorldState`), aber die Testseite selbst wurde **nicht getestet**.
- **Todo:** Manuell verifizieren, dass `/test/experiment-12` noch funktioniert (WASD+Maussteuerung, Floaten, alle Weltsysteme).

### 9. Performance mit größerem `cameraFar`
- **Problem:** `cameraFar` von 45 auf 80 erhöht — mehr Geometrie wird gerendert. Zusammen mit dem breiteren Fog-Bereich könnte die Draw-Call-Anzahl steigen.
- **Todo:** Falls nötig, `renderDistance` im ChunkManager reduzieren oder Seegras-Dichte anpassen.

### 10. `driftSpeed`-Parameter nie angebunden
- **Problem:** Der Parameter `driftSpeed` im Manifest ist definiert, aber `applySettings` ist ein No-Op. Der Wert wird nie an die Player-Logik weitergegeben.
- **Fix:** `applySettings` müsste einen Config-Wert setzen, der in `updatePlayer()` gelesen wird.

---

## 🏗️ Strukturelle Probleme (Architektur)

### S1. Renderer-Typ-Konflikt (WebGPU vs WebGL)
- **Problem:** `types.ts:SetupContext.renderer` ist als `THREE.WebGLRenderer` getypt, aber die VR-Route und experiment-12 nutzen `WebGPURenderer`. Andere Experiences (cloud-towers, gradient-prism) erwarten `WebGLRenderer`. Die Typen sind **inkompatibel** (kein gemeinsames Base-Interface).
- **Workaround:** experiment-12 castet `ctx.renderer as any`. Problem bleibt bei jeder neuen WebGPU-Experience.
- **Fix-Idee:** `SetupContext.renderer` auf ein gemeinsames `THREE.Renderer`-Interface setzen (falls Three.js eines exportiert) oder einen Union-Typ `WebGLRenderer | WebGPURenderer` verwenden.

### S2. Doppelte Lichterzeugung (Loader + Experience)
- **Problem:** `loader.ts:applySceneDefaults()` erzeugt Ambient- + DirectionalLight aus Manifest-Defaults. `createWorldState()` erzeugt **eigene** Lichter (ambient, sun, fill). Die Manifest-Lichter werden auf intensity=0 gesetzt, existieren aber trotzdem im Scene-Graph.
- **Workaround:** intensity=0 in manifest.ts. Ungenutzte Light-Objekte bleiben im Scene-Graph.
- **Fix-Idee:** `createWorldState()` übernimmt die Licht-Erzeugung komplett und der Loader überspringt sie, wenn das Manifest `ambientIntensity=0` setzt. Oder `setup()` entfernt die Loader-Lichter nach `createWorldState()`.

### S3. Fog wird doppelt gesetzt
- **Problem:** Standalone-Pfad (`initWorld`) setzt `scene.fog` direkt. Catalog-Pfad: der Loader setzt Fog aus Manifest-Defaults, dann rendert die Experience drüber. `createWorldState()` liest `scene.fog` aus, ohne es selbst zu setzen — funktioniert nur, weil der Loader/initWorld es vorher setzt.
- **Fix-Idee:** `createWorldState()` sollte Fog explizit setzen (wie es bei Lights auch macht), dann ist der Pfad eindeutig.

### S4. Module-Level-Globals (`_`-Variablen)
- **Problem:** 20+ Modul-Variablen (`_scene`, `_camera`, `_chunkManager`, …) werden von `createWorldState()` gesetzt und von `disposeWorld()`/`destroyWorld()` genullt. Das ist eine **versteckte Abhängigkeit** — alle Funktionen teilen sich denselben globalen Zustand.
- **Risiko:** Wenn zwei Instanzen parallel existieren (durch schnelles Experience-Wechseln), überschreiben sich die Globals.
- **Fix-Idee:** Alle Zustände in das `UnderwaterWorldState`-Objekt verschieben und Modul-Globals eliminieren. `disposeWorld()` könnte aus den Globals den State bauen und `destroyWorld()` aufrufen.

### S5. State-Casting (`as unknown as`)
- **Problem:** Der Experience-State fließt durch die Platform als `ExperienceState` (`Record<string, unknown>`). Jede Bridging-Funktion in `scene.ts` muss mit `as unknown as UnderwaterWorldState` casten. Fehlerhafte Casts werden nicht vom Compiler gefangen.
- **Fix-Idee:** `ExperienceState` könnte als Generic `ExperienceState<T>` definiert werden, oder der Manifest bekäme einen generischen State-Typ-Parameter. Das wäre ein Breaking Change für alle Experiences.

### S6. Bewegungskonzept dupliziert
- **Problem:** Standalone-Pfad (`initWorld`-animate) hat WASD + Floaten + Camera-Rotation via Maus. Catalog-Pfad (`updatePlayer`) hat ICAROS-Pitch/Roll + Floaten + Camera-Rotation via Controller. Zwei **vollständig getrennte** Bewegungssysteme mit eigener Y-Clamping-Logik.
- **Risiko:** Änderungen an einem System müssen manuell im anderen nachgezogen werden.
- **Fix-Idee:** Bewegung in eine gemeinsame `PlayerController`-Klasse auslagern, die je nach Kontext (Standalone/ICAROS) unterschiedliche Input-Quellen nutzt.
