# 🪐 Space World — AI Agent Plan

> **Gilt für:** Claude, Copilot, GPT, und alle anderen KI-Coding-Assistenten.
> **Letztes Update:** 2026-06-14

---

## 🔑 Goldene Regeln

### 1. WebGPU ONLY — niemals WebGL

Space World läuft **ausschließlich** auf `WebGPURenderer`. 

| ✅ Richtig | ❌ Falsch |
|-----------|----------|
| `import * as THREE from "three/webgpu"` | `import * as THREE from "three"` |
| `new THREE.WebGPURenderer({ canvas })` | `new THREE.WebGLRenderer({ canvas })` |
| `PointsNodeMaterial` | `PointsMaterial` |
| `MeshBasicNodeMaterial` | `MeshBasicMaterial` |
| `MeshStandardNodeMaterial` | `MeshStandardMaterial` |
| `ShaderMaterial` (GLSL) | Nur TSL-Nodes via `three/tsl` |
| `await renderer.init()` | Vergiss das nie! |

### 2. Immer aus den Ordnern importieren — nie Code duplizieren

Das gesamte Rendering lebt in eigenen Ordnern. **Niemals Geometrien/Materialien direkt in scene.ts schreiben.**

```
src/lib/experiences/space-world/
├── welt/biome/
│   ├── sterne/index.ts    ← createStarBiome()  – klassisches Sternenfeld
│   ├── galaxien/index.ts  ← createGalaxyBiome() – Spiral/Elliptisch/Irregulär
│   └── ...                ← Neue Biome hier einfügen
├── objekte/
│   ├── planeten/          ← Planeten (TODO)
│   ├── staedte/           ← Sci-Fi-Städte (TODO)
│   ├── raumstationen/     ← Raumstationen (TODO)
│   └── satellite/         ← Satelliten (TODO)
├── sinne/                 ← Sensorische Effekte (TODO)
│   ├── Funkwahrnehmung/
│   └── Magnetfeldwahrnehmung/
├── scene.ts               ← Setup/Tick/Dispose — nur Koordination!
├── player.ts              ← Flugsteuerung
├── settings.ts            ← Parameter-Mapping
└── manifest.ts            ← Experience-Registrierung
```

**Merke:** `scene.ts` importiert NUR aus diesen Ordnern. Es fügt NUR Groups zur Scene hinzu und managed Streaming/Grid. **Keine Geometrien, keine Materialien, keine Shader in scene.ts.**

---

## 📊 Aktueller Stand (Was bereits funktioniert)

| Komponente | Status | Datei |
|-----------|--------|-------|
| WebGPU Renderer + VR | ✅ Fertig | `src/routes/vr/+page.svelte` |
| Experience-Manifest | ✅ Fertig | `manifest.ts` |
| 3×3 Grid-Streaming | ✅ Fertig | `scene.ts` (BIOME_CELL_SIZE=500m) |
| Klassisches Sternenfeld | ✅ Fertig | `welt/biome/sterne/index.ts` (buildClassic, 1500 Sterne/Zelle) |
| Milchstraße (WebGPU) | ✅ Fertig | `welt/biome/sterne/index.ts` (buildMilky) |
| Nebelwolken (WebGPU) | ✅ Fertig | `welt/biome/sterne/index.ts` (buildNebula) |
| Spiralgalaxie (WebGPU) | ✅ Fertig | `welt/biome/galaxien/index.ts` |
| Elliptische Galaxie | ✅ Fertig | `welt/biome/galaxien/index.ts` |
| Irreguläre Galaxie | ✅ Fertig | `welt/biome/galaxien/index.ts` |
| TSL Post-Processing | ✅ Fertig | Bloom + Vignette + Film Grain |
| WASD + Controller | ✅ Fertig | `player.ts` + `scene.ts` tick() |
| Auto-Drift | ✅ Fertig | 12 m/s |
| Hintergrundlayer | ✅ Fertig | 3 Layer (1200m, 1800m, 2800m) |
| Test-Seite Sterne | ✅ Fertig | `/test/sterne` |
| Test-Seite Galaxien | ✅ Fertig | `/test/galaxien` |

### Aktuell aktive Biome in der Experience

Nur `"classic"` — siehe `scene.ts` Zeile mit `const variant: StarVariant = "classic"`. Milky/Nebula sind im Code, aber deaktiviert. Sie können mit der auskommentierten `hashVariant()`-Funktion wieder eingeschaltet werden.

---

## 🎯 Nächste Schritte (TODO — in dieser Reihenfolge)

### 1. Galaxien ins Streaming-Grid einfügen

**Ziel:** Der Spieler fliegt durchs klassische Sternenfeld und trifft periodisch auf eine Galaxie am Horizont.

**Ansatz:**
- `scene.ts` bekommt einen zweiten Grid-Layer für Galaxien mit größerem Zellabstand (z.B. `GALAXY_CELL_SIZE = 2000`)
- `createGalaxyBiome()` wird pro Zelle aufgerufen
- Nur 1×1 oder 3×3 Galaxien gleichzeitig (GPU-Budget!)
- Galaxien erscheinen als weit entfernte Objekte (~1500m Distanz), nicht direkt um den Spieler

**Dateien:**
- `welt/biome/galaxien/index.ts` (existiert bereits — muss nur eingebunden werden)
- `scene.ts` — zweites Grid für Galaxien

### 2. Planeten erstellen

**Ziel:** Prozedurale Planeten als massive Kugeln mit Kratern, Ozeanen, Atmosphären.

**Ordner:** `objekte/planeten/`

**Exportierte Funktion:** `createPlanet(config: PlanetConfig): THREE.Group`

**Ansatz:**
- `IcosphereGeometry` für den Planetenkörper
- `MeshStandardNodeMaterial` mit prozeduralem `colorNode` (TSL)
- Vertex-Farben für Biome (blau = Wasser, grün = Land, weiß = Eis)
- Optional: `RingGeometry` + `TorusGeometry` für Ringe (Saturn-Typ)
- Optional: Transparente äußere Sphäre für Atmosphären-Glow
- In scene.ts: Planeten world-locken via `hash2d()`, spawnen in bestimmten Zellen

### 3. Sci-Fi-Städte erstellen

**Ziel:** Schwebende Städte mit Gebäuden, die in manchen Zellen spawnen.

**Ordner:** `objekte/staedte/`

**Exportierte Funktion:** `createCity(config: CityConfig): THREE.Group`

**Ansatz:**
- Prozedurale Geometrie (keine Modelle!)
- `InstancedMesh` für Gebäude (>100 Gebäude → 1 Draw Call)
- Gebäude: `BoxGeometry` mit zufälligen Höhen
- Kuppeln: `SphereGeometry` mit `phiStart`/`phiLength`
- Fenster: Merged `PlaneGeometry` Grid mit `MeshBasicNodeMaterial` (emissive)
- Stadt schwebt bei Y=+50, world-locked via Grid-Zelle

**Referenz:** Siehe Underwater-World City-System (`AGENTS.md` Zeile 188–195) für Streaming-Logik.

---

## 🧬 TSL Material Guide

Alle Shader in Space World nutzen **TSL** (`three/tsl`), nicht GLSL.

### PointsNodeMaterial (für Sternenfelder, Partikel)

```ts
import { attribute, float, vec3, vec4 } from "three/tsl";
import { PointsNodeMaterial } from "three/webgpu";

const mat = new PointsNodeMaterial();
mat.sizeNode = attribute("aSize", "float");       // Punktgröße pro Vertex
mat.colorNode = vec4(attribute("color", "vec3"), float(1.0)); // Vertex-Farbe
mat.sizeAttenuation = true;   // Perspektivische Skalierung
mat.transparent = true;
mat.depthWrite = false;
mat.blending = THREE.AdditiveBlending; // Leucht-Effekt im Weltraum
```

### MeshBasicNodeMaterial (für Glows, einfache Objekte)

```ts
import { vec4, float } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

const mat = new MeshBasicNodeMaterial();
mat.colorNode = vec4(float(1.0), float(0.5), float(0.2), float(0.8));
mat.transparent = true;
```

### MeshStandardNodeMaterial (für beleuchtete Objekte wie Planeten)

```ts
import { MeshStandardNodeMaterial } from "three/webgpu";
// Kein colorNode nötig — .color property funktioniert wie WebGL
const mat = new MeshStandardNodeMaterial({ color: 0x4488cc });
```

### Post-Processing (Bloom, Grain, Vignette)

```ts
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { pass } from "three/tsl";

const pp = new THREE.PostProcessing(renderer);
const scenePass = pass(scene, camera);
let output = scenePass.getTextureNode("output");
output = output.add(bloom(output, 1.2, 0.4, 0.3)); // strength, radius, threshold
pp.outputNode = output;
// Im Loop: pp.render()
```

---

## 🏗️ Grid-Streaming System (scene.ts)

```
Welt ist in 500m-Zellen unterteilt (BIOME_CELL_SIZE).
3×3 Grid = 9 Zellen aktiv um den Spieler.

Spieler bei (250, 0, -300):
  Zelle (0, -1) wegen floor(250/500)=0, floor(-300/500)=-1

  Aktive Zellen: dx=[-1,0,1], dz=[-2,-1,0]
  ┌─────┬─────┬─────┐
  │-1,-2│ 0,-2│ 1,-2│
  ├─────┼─────┼─────┤
  │-1,-1│ 0,-1│ 1,-1│  ← Spieler ist in (0,-1)
  ├─────┼─────┼─────┤
  │-1, 0│ 0, 0│ 1, 0│
  └─────┴─────┴─────┘

Sobald Spieler Zelle wechselt → alte Zellen entfernen, neue streamen.
Jede Zelle = 1× createStarBiome(variant) → 1500 Sterne.
```

### Neues Objekt-Streaming (für Planeten, Städte, Galaxien)

Für neue Objekttypen dasselbe Muster verwenden:

```ts
// In scene.ts setup:
const planets = new Map<string, PlanetSystem>();

// In scene.ts tick():
if (pcx !== lastCX || pcz !== lastCZ) {
  // Prüfe welche Planeten-Zellen gebraucht werden
  // Entferne alte, füge neue hinzu
}
```

---

## 🚀 Flugsteuerung

| Eingabe | Aktion |
|---------|--------|
| W / Pfeil Hoch | Vorwärts (in Blickrichtung) |
| S / Pfeil Runter | Rückwärts |
| A / Pfeil Links | Links drehen (Yaw) |
| D / Pfeil Rechts | Rechts drehen (Yaw) |
| R | Pitch hoch |
| F | Pitch runter |
| ICAROS Neigung | Pitch + Yaw (parallel zu WASD) |
| ICAROS Beschleunigen | Boost (2× Speed) |
| Auto-Drift | 12 m/s wenn keine Taste gedrückt |

---

## ✅ Checkliste für neue Features

Bevor ein Feature als "fertig" gilt:

- [ ] `bunx svelte-check --threshold warning` → 0 errors
- [ ] `bun run build` → erfolgreich
- [ ] Geometrien/Materialien werden in `dispose()` aufgeräumt
- [ ] Kein Code in `scene.ts` dupliziert — alles in eigenen Ordnern
- [ ] WebGPU-kompatibel: `three/webgpu` imports, TSL-Materialien
- [ ] Performance: InstancedMesh wo möglich, AdditiveBlending für Weltraum
- [ ] Test-Seite existiert unter `/test/[feature]`
