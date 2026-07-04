<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { browser } from "$app/environment";
    import * as THREE from "three/webgpu";
    import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

    import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
    import type { PheromonVariant } from "$lib/experiences/insect-world-v2/Sinne/Pheromonspuren/pheromonspuren";

    // ── 5 Abstands-Varianten ──
    // Nur trailLengthMin/Max unterscheidet sich.
    const DISTANCE_VARIANTS: (PheromonVariant & { color: string })[] = [
        {
            name: "① Sehr kurz",
            color: "#ff6b6b",
            desc: "1–3m – wie aktuell – Spur fast nur an der Blume",
            particlesPerTrail: 80,
            particleSize: 0.18,
            opacity: 0.85,
            trailLengthMin: 1,
            trailLengthMax: 3,
            windAmplitude: 0.25,
            windFrequency: 1.5,
            scatterWidth: 0.3,
            scatterHeight: 0.15,
            pulseSpeed: 1.5,
            pulseAmount: 0.25,
        },
        {
            name: "② Kurz",
            color: "#ffa94d",
            desc: "3–6m – Spur beginnt etwas früher",
            particlesPerTrail: 80,
            particleSize: 0.18,
            opacity: 0.85,
            trailLengthMin: 3,
            trailLengthMax: 6,
            windAmplitude: 0.25,
            windFrequency: 1.5,
            scatterWidth: 0.3,
            scatterHeight: 0.15,
            pulseSpeed: 1.5,
            pulseAmount: 0.25,
        },
        {
            name: "③ Mittel",
            color: "#ffd43b",
            desc: "6–12m – gut sichtbar von Weitem",
            particlesPerTrail: 80,
            particleSize: 0.18,
            opacity: 0.85,
            trailLengthMin: 6,
            trailLengthMax: 12,
            windAmplitude: 0.25,
            windFrequency: 1.5,
            scatterWidth: 0.3,
            scatterHeight: 0.15,
            pulseSpeed: 1.5,
            pulseAmount: 0.25,
        },
        {
            name: "④ Weit",
            color: "#69db7c",
            desc: "12–20m – deutlich sichtbar von Weitem",
            particlesPerTrail: 80,
            particleSize: 0.18,
            opacity: 0.85,
            trailLengthMin: 12,
            trailLengthMax: 20,
            windAmplitude: 0.25,
            windFrequency: 1.5,
            scatterWidth: 0.3,
            scatterHeight: 0.15,
            pulseSpeed: 1.5,
            pulseAmount: 0.25,
        },
        {
            name: "⑤ Sehr weit",
            color: "#4dabf7",
            desc: "20–35m – schon von ganz weit weg sichtbar",
            particlesPerTrail: 80,
            particleSize: 0.18,
            opacity: 0.85,
            trailLengthMin: 20,
            trailLengthMax: 35,
            windAmplitude: 0.25,
            windFrequency: 1.5,
            scatterWidth: 0.3,
            scatterHeight: 0.15,
            pulseSpeed: 1.5,
            pulseAmount: 0.25,
        },
    ];

    // ── States ──
    let canvas: HTMLCanvasElement;
    let renderer: THREE.WebGPURenderer;
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let controls: OrbitControls;
    let animationId: number;
    let errorMsg = $state("");
    let loading = $state(true);
    let activeIndex = $state(0);

    const activeVariant = $derived(DISTANCE_VARIANTS[activeIndex]);

    // ── Feste Positionen (3 Blumen, immer gleich) ──
    // Jede Blume bekommt eine feste "Saat"-Zahl, damit die Spur immer gleich aussieht.
    const FLOWER_DATA = [
        {
            pos: new THREE.Vector3(-2.5, 0.2, -0.5),
            color: new THREE.Color(0xe87da0),
            seed: 42,
        },
        {
            pos: new THREE.Vector3(0, 0.2, 0.8),
            color: new THREE.Color(0xf5d742),
            seed: 77,
        },
        {
            pos: new THREE.Vector3(2.5, 0.2, -0.3),
            color: new THREE.Color(0xf0ece4),
            seed: 123,
        },
    ];

    // Drei Ringe als Bodenmarkierung (Blumen-Positionen)
    const RING_COLORS = [0xe87da0, 0xf5d742, 0xf0ece4];

    // ── Three.js-Objekte (werden in onMount gesetzt) ──
    let spriteGroup: THREE.Group;
    let glowTexture: THREE.CanvasTexture;
    let trailPhases: number[] = [];

    // ── Deterministischer Zufall (Seeded Random) ──
    // Liefert zu einer "Saat" immer die gleiche Zahlen-Folge.
    function seededRandom(seed: number): number {
        const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    // ── Glow-Textur ──
    function createGlowTexture(): THREE.CanvasTexture {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const g = ctx.createRadialGradient(
            size / 2,
            size / 2,
            0,
            size / 2,
            size / 2,
            size / 2,
        );
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.08, "rgba(255,255,255,0.85)");
        g.addColorStop(0.25, "rgba(255,255,255,0.4)");
        g.addColorStop(0.5, "rgba(255,255,255,0.15)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    // ── Farbe maximieren ──
    function maxSaturate(color: THREE.Color): THREE.Color {
        const hsl = { h: 0, s: 0, l: 0 };
        color.getHSL(hsl);
        if (hsl.l > 0.7 && hsl.s < 0.4) return new THREE.Color(0xffffff);
        return new THREE.Color().setHSL(hsl.h, 1, 0.6);
    }

    /**
     * Baut die 3 Spuren für eine Variante.
     * Nutzt seededRandom() mit der Blumen-Saat, damit jede Variante
     * das GLEICHE Partikel-Muster hat – nur die Distanz ändert sich.
     */
    function buildTrails(v: PheromonVariant): void {
        // Alte Sprites entfernen
        while (spriteGroup.children.length > 0) {
            const child = spriteGroup.children[0];
            if (
                child instanceof THREE.Sprite &&
                child.material instanceof THREE.SpriteMaterial
            ) {
                child.material.dispose();
            }
            spriteGroup.remove(child);
        }
        trailPhases = [];

        // Für jede der 3 Blumen eine Spur bauen
        for (let fi = 0; fi < FLOWER_DATA.length; fi++) {
            const { pos, color, seed } = FLOWER_DATA[fi];
            const count = v.particlesPerTrail;
            const positions = new Float32Array(count * 3);

            // Zufallswert-Basis für diese Blume (immer gleich, egal welche Variante)
            let rng = seed;

            // Start-Richtung (Winkel) – fest pro Blume
            const angle = seededRandom(rng++) * Math.PI * 2;
            // Distanz – variiert pro Variante (das ist der zu testende Wert)
            const dist =
                v.trailLengthMin +
                seededRandom(rng++) * (v.trailLengthMax - v.trailLengthMin);
            const startX = pos.x + Math.cos(angle) * dist;
            const startZ = pos.z + Math.sin(angle) * dist;
            const startY = 0.2 + seededRandom(rng++) * 0.6;

            // Kurve von Start → Blume
            const steps = 80;
            const curve: THREE.Vector3[] = [];
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                let x = startX * (1 - t) + pos.x * t;
                let z = startZ * (1 - t) + pos.z * t;
                let y = startY * (1 - t) + pos.y * t;
                const windPhase = angle + t * v.windFrequency;
                const wind = v.windAmplitude * t * (1 - t) * 4;
                x += Math.sin(windPhase) * wind;
                z += Math.cos(windPhase * 0.8) * wind;
                y += Math.sin(windPhase * 1.2) * wind * 0.3;
                curve.push(new THREE.Vector3(x, y, z));
            }

            // Partikel auf der Kurve – feste Zufallswerte pro Blume
            for (let i = 0; i < count; i++) {
                const t = seededRandom(rng++);
                const idx = Math.floor(t * steps);
                const frac = t * steps - idx;
                const nextIdx = Math.min(idx + 1, steps);
                const p = new THREE.Vector3().lerpVectors(
                    curve[idx],
                    curve[nextIdx],
                    frac,
                );
                const dir = new THREE.Vector3()
                    .subVectors(
                        curve[Math.min(idx + 2, steps)],
                        curve[Math.max(idx - 2, 0)],
                    )
                    .normalize();
                const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
                const scatterFactor = t * (1 - t) * 4;
                const oh =
                    (seededRandom(rng++) - 0.5) *
                    v.scatterWidth *
                    scatterFactor;
                const ov =
                    (seededRandom(rng++) - 0.5) *
                    v.scatterHeight *
                    scatterFactor;
                positions[i * 3] = p.x + perp.x * oh;
                positions[i * 3 + 1] = p.y + ov;
                positions[i * 3 + 2] = p.z + perp.z * oh;
            }

            // Material
            const material = new THREE.SpriteMaterial({
                map: glowTexture,
                color: maxSaturate(color),
                transparent: true,
                opacity: v.opacity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });

            // Sprites erzeugen
            for (let i = 0; i < count; i++) {
                const sprite = new THREE.Sprite(material);
                sprite.position.set(
                    positions[i * 3],
                    positions[i * 3 + 1],
                    positions[i * 3 + 2],
                );
                sprite.scale.set(v.particleSize, v.particleSize, 1);
                spriteGroup.add(sprite);
            }

            trailPhases.push(seededRandom(rng) * Math.PI * 2);
        }
    }

    // ── Umschalt-Funktion (wird vom Button gerufen) ──
    function selectVariant(index: number): void {
        activeIndex = index;
        if (glowTexture && spriteGroup) {
            buildTrails(DISTANCE_VARIANTS[index]);
        }
    }

    onMount(async () => {
        try {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x0a1520);

            const w = canvas.clientWidth;
            const h = canvas.clientHeight;

            camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 120);
            camera.position.set(6, 5, 12);

            renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
            await renderer.init();
            renderer.setSize(w, h);
            renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

            controls = new OrbitControls(camera, renderer.domElement);
            controls.target.set(0, 0.5, 0);
            controls.update();

            // Licht
            const ambient = new THREE.AmbientLight(0x445566, 0.4);
            scene.add(ambient);
            const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
            sun.position.set(30, 50, 20);
            scene.add(sun);

            // Himmel
            const sky = createSky("tief");
            scene.add(sky);

            // Boden
            const groundGeo = new THREE.PlaneGeometry(120, 120);
            const groundMat = new THREE.MeshBasicMaterial({
                color: 0x1a2a1a,
                side: THREE.DoubleSide,
            });
            const ground = new THREE.Mesh(groundGeo, groundMat);
            ground.rotation.x = -Math.PI / 2;
            scene.add(ground);

            // Raster (1 Kästchen = 1 Meter)
            const grid = new THREE.GridHelper(60, 30, 0x444466, 0x333355);
            grid.position.y = 0.01;
            scene.add(grid);

            // Blumen-Markierungen (Ringe)
            for (let i = 0; i < 3; i++) {
                const rg = new THREE.RingGeometry(0.2, 0.5, 16);
                const rm = new THREE.MeshBasicMaterial({
                    color: RING_COLORS[i],
                    transparent: true,
                    opacity: 0.5,
                    side: THREE.DoubleSide,
                });
                const ring = new THREE.Mesh(rg, rm);
                ring.position.copy(FLOWER_DATA[i].pos);
                ring.position.y = 0.01;
                ring.rotation.x = -Math.PI / 2;
                scene.add(ring);
            }

            // Blumen-Kugeln (kleine 3D-Punkte als Blumen-Ersatz)
            for (let i = 0; i < 3; i++) {
                const sphere = new THREE.Mesh(
                    new THREE.SphereGeometry(0.2, 8, 8),
                    new THREE.MeshBasicMaterial({ color: RING_COLORS[i] }),
                );
                sphere.position.copy(FLOWER_DATA[i].pos);
                scene.add(sphere);
            }

            // Glow-Textur
            glowTexture = createGlowTexture();

            // Sprite-Gruppe
            spriteGroup = new THREE.Group();
            scene.add(spriteGroup);

            // Erste Variante bauen
            buildTrails(DISTANCE_VARIANTS[0]);

            loading = false;

            // Animation
            const clock = new THREE.Clock();
            function animate() {
                const elapsed = clock.getElapsedTime();
                const spriteChildren = spriteGroup.children;
                for (let i = 0; i < spriteChildren.length; i++) {
                    const sprite = spriteChildren[i];
                    if (
                        sprite instanceof THREE.Sprite &&
                        sprite.material instanceof THREE.SpriteMaterial
                    ) {
                        const trailIdx = Math.min(
                            Math.floor(i / 80),
                            trailPhases.length - 1,
                        );
                        const phase = trailPhases[trailIdx] ?? 0;
                        const pulse =
                            0.75 + 0.25 * Math.sin(elapsed * 1.5 + phase);
                        sprite.material.opacity = 0.85 * pulse;
                    }
                }
                controls.update();
                renderer.render(scene, camera);
                animationId = requestAnimationFrame(animate);
            }
            animationId = requestAnimationFrame(animate);
        } catch (e) {
            console.error("[Pheromon] FEHLER:", e);
            errorMsg = e instanceof Error ? e.message : String(e);
            loading = false;
        }
    });

    onDestroy(() => {
        if (!browser) return;
        cancelAnimationFrame(animationId);
        renderer?.dispose();
        controls?.dispose();
    });
</script>

/** * Testseite: Pheromonspuren-Abstandsvergleich. * * Zeigt EINE Blumengruppe
mit Pheromonspuren. * Per Knopfdruck schaltest du zwischen 5 verschiedenen
Trail-Längen um * (Abstand Blume → Spur-Anfang). * * Wichtig: Die Zufallswerte
sind "fest verdrahtet" (Seeded Random), * damit sich beim Umschalten NUR der
Abstand ändert – nicht das Muster. * * Nutzt WebGPU (WebGPURenderer) laut
Projekt-Vorgabe. */

<div class="container">
    <canvas bind:this={canvas}></canvas>

    <!-- Oben: Info -->
    <div class="ui-overlay">
        <h1>🧪 Pheromonspuren – Abstandsvergleich</h1>
        {#if loading}<p class="loading">Lade …</p>{/if}
        {#if errorMsg}<p class="error">{errorMsg}</p>{/if}
    </div>

    <!-- Unten: Steuerleiste -->
    <div class="controls">
        <div class="info">
            <span class="badge" style="background: {activeVariant.color};"
            ></span>
            <span class="vname">{activeVariant.name}</span>
            <span class="vdist">
                🌼 ← {activeVariant.trailLengthMin}–{activeVariant.trailLengthMax}m
            </span>
        </div>
        <p class="vdesc">{activeVariant.desc}</p>
        <div class="buttons">
            {#each DISTANCE_VARIANTS as v, i}
                <button
                    class="btn"
                    class:active={activeIndex === i}
                    style="--c: {v.color};"
                    onclick={() => selectVariant(i)}>{v.name}</button
                >
            {/each}
        </div>
        <p class="hint">Ziehen zum Drehen • Scrollen zum Zoomen</p>
    </div>
</div>

<style>
    .container {
        position: fixed;
        inset: 0;
        overflow: hidden;
        font-family: system-ui, sans-serif;
    }
    canvas {
        display: block;
        width: 100%;
        height: 100%;
    }

    .ui-overlay {
        position: absolute;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        pointer-events: none;
        z-index: 10;
    }
    .ui-overlay h1 {
        color: white;
        font-size: 1.1rem;
        font-weight: 600;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        margin: 0;
    }
    .loading {
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.85rem;
    }
    .error {
        color: #ff6b6b;
        font-size: 0.85rem;
        background: rgba(0, 0, 0, 0.5);
        padding: 4px 12px;
        border-radius: 4px;
    }

    .controls {
        position: absolute;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(10px);
        border-radius: 14px;
        padding: 14px 24px 12px;
        z-index: 10;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.08);
        min-width: 300px;
        max-width: 92vw;
    }

    .info {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin-bottom: 2px;
    }
    .badge {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        flex-shrink: 0;
        box-shadow: 0 0 6px currentColor;
    }
    .vname {
        color: white;
        font-size: 1rem;
        font-weight: 700;
    }
    .vdist {
        color: rgba(255, 255, 255, 0.45);
        font-size: 0.8rem;
    }

    .vdesc {
        color: rgba(255, 255, 255, 0.45);
        font-size: 0.72rem;
        margin: 2px 0 10px;
    }

    .buttons {
        display: flex;
        gap: 5px;
        justify-content: center;
        flex-wrap: wrap;
    }
    .btn {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.65);
        padding: 6px 14px;
        border-radius: 7px;
        font-size: 0.78rem;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
    }
    .btn:hover {
        background: rgba(255, 255, 255, 0.12);
        color: white;
    }
    .btn.active {
        background: color-mix(in srgb, var(--c, gold) 35%, transparent);
        border-color: var(--c, gold);
        color: white;
        font-weight: 600;
        box-shadow: 0 0 10px color-mix(in srgb, var(--c, gold) 25%, transparent);
    }

    .hint {
        color: rgba(255, 255, 255, 0.25);
        font-size: 0.62rem;
        margin: 7px 0 0;
    }
</style>
