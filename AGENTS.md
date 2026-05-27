# 🤖 AI Development Guide

Instructions for Claude, Copilot, and other AI coding assistants.

---

## Project Context

**ICAROS VR Starter** — WebXR flight simulation for Meta Quest controlled by ICAROS fitness device.

| Stack | Tool |
|-------|------|
| Framework | SvelteKit |
| Runtime | Bun |
| 3D Engine | Three.js |
| VR/AR | WebXR API |
| UI | bits-ui |
| Linting | Biome |
| Type Checking | TypeScript (strict) |

---

## Architecture

```
Controller UI (/controller)
       ↓ WebSocket (pitch, roll, speed, settings)
SvelteKit Server (hooks.server.ts)
       ↓ broadcast
VR Scene (/vr on Quest)
       ↓ FlightPlayer.updateOrientation()
Three.js Render Loop @ 72fps
```

Key directories:
- `src/lib/three/` — 3D world components
- `src/lib/node-editor/` — Visual node editor (Eurorack architecture: Components → Nodes → Canvas)
- `src/lib/config/flight.ts` — All tuning constants
- `src/lib/ws/` — WebSocket client/server
- `src/lib/types/` — TypeScript interfaces

---

## Constraints

### Never

- ❌ Use `any` type
- ❌ Use ESLint/Prettier (use **Biome**)
- ❌ Use `pip` (use **uv** for Python)
- ❌ Top-level Three.js imports without `onMount()`
- ❌ `requestAnimationFrame` (use `renderer.setAnimationLoop`)
- ❌ Forget `dispose()` in `onDestroy`
- ❌ Hardcode values (use `lib/config/flight.ts`)
- ❌ HTTP for WebXR (must be HTTPS)

### Always

- ✅ Explicit TypeScript types
- ✅ `onMount()` for browser APIs
- ✅ `onDestroy()` for cleanup
- ✅ Import config values from `flight.ts`
- ✅ Run `bunx biome check --write .` before committing

---

## Decision Tree

Before writing code:

1. **Does this exist?** → Search codebase first
2. **Built-in solution?** → Check SvelteKit, Three.js, bits-ui
3. **Already installed?** → Check `package.json`
4. **Add dependency?** → Research first, then `bun add`
5. **Custom code** → Last resort

---

## Performance Budget

| Metric | Target |
|--------|--------|
| FPS | 72 (Quest refresh) |
| Draw calls | < 100 |
| Triangles | < 500k |
| JS frame time | < 11ms |

Use `InstancedMesh` for repeated geometry. Chunk terrain. Pool objects.

---

## Testing

```bash
bun run dev                            # Manual testing in browser
bunx biome check --write .             # Lint + format
bunx svelte-check --threshold warning  # Type check
```

No unit tests currently — focus on visual testing in VR.

---

## 🌊 Underwater World — Experience Summary

### Goal
Immersive underwater VR experience with bioluminescent fish school, kelp, coral reefs, jellyfish, sharks, dolphins, sci-fi city, and echolocation ring system.

### Architecture (files)
| File | Purpose |
|------|---------|
| `src/lib/experiences/underwater-world/scene.ts` | ~2375 lines — setup, tick, dispose, all geometries, materials, streaming, audio |
| `src/lib/experiences/underwater-world/settings.ts` | Parameter apply (driftSpeed, wasdSpeed, echolocationEnabled/Range, lightIntensity, terrainAmplitude/Scale) |
| `src/lib/experiences/underwater-world/shaders.ts` | Echo ShaderMaterial (uTime, uColor, uIntensity) |
| `src/lib/experiences/underwater-world/manifest.ts` | 11 parameters, scene config (bg #001830, fog 10–180m, ambient 0.5, sun 0.8) |
| `src/lib/types.ts` | Base types (ExperienceState, ParameterDef, SetupContext, TickContext) |
| `src/lib/experiences/loader.ts` | Creates AmbientLight + DirectionalLight from manifest config |
| `static/sounds/` | All sound files (.mp3) |

### Controls
| Input | Action |
|-------|--------|
| W / S | Up / Down (Y-axis only, no pitch) |
| A / D | Yaw (rotation) |
| R / F | Pitch up / Pitch down (±60°) |
| Space | Speed boost (driftSpeed 2→20, decays to 1.5) + movement sound |
| Q | Toggle echolocation rings on/off |
| Auto-drift | Always forward in camera direction (Y=0), starts at 2 m/s |

### World Structure
- **Terrain**: 400×400m chunks, **3×3 grid = 9 chunks active**, 48 segments, FBM 4 octaves
- **Streaming**: directional — forward 400m, backward 120m, initial 200m, 40 instances/frame
- **Fog**: 180m range masks chunk edges
- **Water surface**: Y=75
- **Biomes**: **3** (merged): Mountain (<0.55, amp×1.0), Flat/Sand (0.55–0.75), City (≥0.75)

### Objects & Counts
| Object | Count | Detail |
|--------|-------|--------|
| Coral | 2000 | World-locked via hash2d(), ±1500m, procedural (Icosahedron + noise), 6 colors, streaming (200m init, 400m fwd, 120m back) |
| Kelp | 2000 | World-locked, ±1500m, procedural geometry, static (no sway), streaming |
| Rocks | 120 | World-locked via hash2d(), InstancedMesh |
| Jellyfish | 10 | Floating, sine-wave vertical bob |
| Fish school | 80 | Boids flocking, follow player, teleport if >200m away, loaded OBJ model |
| Sharks | 3 | Patrol ±50m around player, max 3 m/s, loaded GLB model |
| Dolphins | 2 | Procedural geometry (Z-aligned), patrol ±50m, max 4 m/s |
| City | 1 | Procedural (dome + 80 InstancedMesh buildings + merged window grid). Spawns only on flat terrain (40m radius, max 4m diff). Floats 8m above ground. Active when player <600m, deactivates at >700m. No start city. |
| Bioluminescence | 500 particles | Drift around player |
| Echo rings | 60 pooled | Thin `RingGeometry(0.9, 1.0)`, cyan AdditiveBlending, expand at 8m/s over 5s, linear fade. Emit every 10s from creatures/objects. Burst queue for delayed multi-emits. |

### Audio System (Web Audio API, 5 Tracks)
| Track | File | When | Gain |
|-------|------|------|------|
| **BG-Atmo** | `dragon-studio-deep-sea-underwater-ambience-472383.mp3` | Loop, always | 0.14–0.24 (ducks at Surface/City) |
| **Surface** | `dragon-studio-deep-sea-underwater-ambience-482888.mp3` | Crossfade Y=40→70 | 0 → 0.35 |
| **City** | `mavopix-underwater-159894.mp3` | Crossfade near city | 0 → 0.5 |
| **Echo-Ping** | `dragon-studio-deepsea-sonar-386156.mp3` | On ring emission + object near source | playbackRate 0.6, gain 0.5 |
| **Space-Boost** | `freesound_community-underwater-movement-66914.mp3` | On Space press | 0.7 |
| Master | — | — | 0.4 |

Crossfades with `delta * 2` smoothing.

### 3D Model Loading (`src/lib/three/loader.ts`)
- `loadGLTF(path)` — GLTFLoader wrapper
- `loadModelGeometry(path)` — extracts first mesh, clones, removes JOINTS_0/WEIGHTS_0/TEXCOORD_0, centers → BufferGeometry or undefined
- Fallback: procedural geometry on load failure
- Models in `static/models/`: animated_low_poly_fish_gltf/, shark.glb, Korallen/ (4× OBJ), delfin/ (OBJ)

### Echo Ring System
- 60 pooled `RingGeometry(0.9, 1.0, 48)` meshes, rotateX(-π/2), `MeshBasicMaterial` color 0x00e5ff, AdditiveBlending, depthWrite: false, DoubleSide
- Global emission timer fires every 10s (ECHO_EMIT_INTERVAL):
  - Each fish/shark/dolphin/jellyfish → 1 ring at its position
  - Each rock/coral/kelp cluster → 2-ring burst (0.4s delay via burst queue)
  - City → 3-ring burst
- Rings expand at 8m/s (ECHO_RING_EXPAND_SPEED), live 5s (ECHO_RING_LIFETIME), opacity fades linearly from 0.8→0
- Burst queue schedules delayed secondary emits (ECHO_BURST_DELAY = 0.4s)
- Activation: **Q key** toggles echo on/off (default on). **Dolphin proximity ≤ 6m** auto-activates echo while dolphin is near.
- Sound: Echo-Ping plays when ring emits and a source object is nearby

### Guidance Lines
- 3 `THREE.Line` objects (20 segments, `LineBasicMaterial`, AdditiveBlending):
  - 1 cyan (0x00e5ff) → leads to nearest unactivated city biome
  - 2 blue (0x44aaff) → lead to dolphins within 200m range
- Gentle low-frequency sine wave deformation: `Math.sin(t * 0.15 + elapsed * 0.3) * 2`
- Opacity fades with distance: city 8–50%, dolphins 12–50%
- Hidden when dist < 5m or no valid target

### City System
- Fully procedural: geodesic dome + 80 InstancedMesh buildings + merged window grid
- `CITY_Y_OFFSET = 8` — city floats 8m above terrain
- `findNearestCity(cx, cz, range, baseAmp?, baseScale?, minDistSq?)` — numeric range parameter
- `isTerrainFlat(cx, cz, baseAmp, baseScale, 40, 4)` — 8 radial samples, max 4m height diff
- No start city at level load. City only spawns when player reaches a natural city biome (terrain ≥ 0.75) on flat ground
- Active when `dSq < 360000` (≤600m), deactivates when `dSq > 490000` (>700m)
- City stays at position once active (Y follows terrain), no far-range glow

### Key Constants (scene.ts)
| Constant | Value |
|----------|-------|
| `CHUNK_SIZE` | 400m |
| `CHUNK_SEGMENTS` | 48 |
| `CHUNK_RADIUS` | 1 (3×3 grid) |
| `CHUNK_RADIUS_INIT` | 1 |
| `FISH_COUNT` | 80 |
| `JELLY_COUNT` | 10 |
| `SHARK_COUNT` | 3 |
| `CORAL_MAX` | 2000 |
| `KELP_MAX` | 2000 |
| `ECHO_RING_POOL_SIZE` | 60 |
| `ECHO_RING_LIFETIME` | 5s |
| `ECHO_RING_EXPAND_SPEED` | 8m/s |
| `ECHO_EMIT_INTERVAL` | 10s |
| `ECHO_BURST_DELAY` | 0.4s |
| `ECHO_DOLPHIN_RANGE` | 6m |
| `ECHO_DOLPHIN_GUIDE_RANGE` | 200m |
| `CITY_Y_OFFSET` | 8 |
| `CITY_GRID` | 180 |
| `CITY_DOME_RADIUS` | 65 |
| `STREAM_INITIAL_RADIUS` | 200m |
| `STREAM_LOAD_RADIUS_FWD` | 400m |
| `STREAM_LOAD_RADIUS_BACK` | 120m |
| `STREAM_PER_FRAME` | 40 |
| `driftSpeed` start | 2 |
| `driftSpeed` min | 1.5 |
| `driftSpeed` max | 20 |
| `WATER_SURFACE_Y` | 75 |
| `TERRAIN_BASE_Y` | -3 |

### Key Design Decisions
- **One file**: scene.ts contains setup, tick, dispose for entire experience (~2375 lines)
- **Pooled echo rings**: 60 thin-ring pool enables unlimited simultaneous rings without allocation; burst queue handles delayed multi-emits
- **Directional streaming**: loads flora forward 400m but only 120m behind — player never sees pop-in ahead
- **3×3 terrain chunks** (400m each): smoother terrain transitions than single chunk, 48 segments for detail
- **No textures on non-city objects**: corals use procedural Icosahedron + noise, 6 baked colors via vertex colors
- **Z-alignment**: sharks & dolphins have body along Z-axis (head at -Z), fish convention
- **Shark model fix**: model was upside-down — rotateX(Math.PI) after loading
- **Dolphin geometry**: fully procedural — all parts along Z-axis
- **City floats at Y_OFFSET=8**: prevents clipping into terrain, visible from distance
- **No start city**: city only appears when player reaches a natural city biome with flat terrain (isTerrainFlat check)
- **City stays put**: once active + player <600m, stays at position (only Y follows terrain). Deactivates at >700m
- **W/S = Y only**: movement decoupled from pitch, pitch via R/F only
- **Space = speed boost**: driftSpeed ramps 2→20, decays to 1.5
- **GLTF → procedural fallback**: every loaded model has a procedural alternative
- **Biome merge**: Mountain + Reef merged into one (< 0.55, dampened terrain amp×1.0). Corals spawn in merged biome
- **Guidance lines**: gentle curve (low-freq sine, amp 2) instead of sharp zigzag — 3 lines, cyan to city, blue to dolphins
- **Q key toggles echo**: persistent toggle, dolphin proximity auto-enables when near

### Performance Optimizations Applied
| Optimization | Detail |
|-------------|--------|
| Pixel Ratio capped | `Math.min(devicePixelRatio, 1.5)` |
| Shadows disabled | `shadowMap.enabled = false` |
| FBM octaves reduced | Biome: 2, Terrain: 4 |
| Rocks → InstancedMesh | 120 meshes → 1 draw call |
| City Buildings → InstancedMesh | 80 meshes → 1 draw call |
| City Windows → merged | 300-400 meshes → 1 mesh |
| Echo Rings → pooled | 60 pre-allocated, recycle instead of create |
| Textures removed | No `map` on fish/corals/kelp |
| Kelp Sway removed | No per-frame matrix updates |
| Streaming directional | 400m forward, 120m back — less unnecessary loading |
| Chunk loading | 9 active (3×3), gradual transition |
| Drift speed lowered | 6→2 start, 40→20 max, 4→1.5 min |
| No start city | City only appears ≥600m on flat terrain |

### Performance
- `bunx svelte-check --threshold warning` passes with 0 errors
- Draw calls < 100 targets
- Flora is static (world-locked, no sway) — no per-frame updates
- Fish boids, jellyfish, sharks, dolphins update every frame (simple math)
- Chunk loads/unloads on grid cross (3×3 active)
- Streaming processes 40 flora instances/frame
- Echo ring emission runs on global 10s timer — negligible per-frame cost
- Guidance lines update 3×20 vertices — trivial
- No unit tests — visual testing only

### Removed Constants (no longer in use)
| Constant | Reason |
|----------|--------|
| `ECHO_RING_COUNT` | Replaced by pool system |
| `ECHO_RING_SPEED` | Replaced by `ECHO_RING_EXPAND_SPEED` |
| `ECHO_FOV_COS` | No FOV-gated echo pings |
| `ECHO_DETECT_THRESHOLD` | No raycast-based detection |
| `ECHO_FLASH_COUNT` | Removed InstancedMesh flashes |
| `CITY_FAR_VISIBLE_RANGE` | No far-range glow |
