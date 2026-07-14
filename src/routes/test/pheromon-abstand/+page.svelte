<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { browser } from "$app/environment";
    import * as THREE from "three/webgpu";
    import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

    import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
    import type { PheromonVariant } from "$lib/experiences/insect-world-v2/Sinne/Pheromonspuren/pheromonspuren";

    // ── Parameter (wie "Leuchtpfad", aber 20–35m Distanz) ──
    const TRAIL_VARIANT: PheromonVariant = {
        name: "Test",
        desc: "",
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
    };

    // ── States ──
    let canvas: HTMLCanvasElement;
    let renderer: THREE.WebGPURenderer;
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let controls: OrbitControls;
    let animationId: number;
    let errorMsg = $state("");
    let loading = $state(true);

    // ── Blumen-Positionen (2 Gruppen: links & rechts) ──
    // Links: aktuelle Implementierung (zufällige Richtung)
    // Rechts: neue Idee (Richtung zum Player)
    const PLAYER_POS = new THREE.Vector3(0, 2, 0);

    // 3 Blumen links (für "Zufällige Richtung")
    const LEFT_FLOWERS = [
        {
            pos: new THREE.Vector3(-18, 0.2, -25),
            color: new THREE.Color(0xe87da0),
            seed: 10,
        },
        {
            pos: new THREE.Vector3(-15, 0.2, -28),
            color: new THREE.Color(0xf5d742),
            seed: 20,
        },
        {
            pos: new THREE.Vector3(-21, 0.2, -27),
            color: new THREE.Color(0xf0ece4),
            seed: 30,
        },
    ];

    // 3 Blumen rechts (für "Richtung Player")
    const RIGHT_FLOWERS = [
        {
            pos: new THREE.Vector3(15, 0.2, -25),
            color: new THREE.Color(0xe87da0),
            seed: 40,
        },
        {
            pos: new THREE.Vector3(18, 0.2, -28),
            color: new THREE.Color(0xf5d742),
            seed: 50,
        },
        {
            pos: new THREE.Vector3(12, 0.2, -27),
            color: new THREE.Color(0xf0ece4),
            seed: 60,
        },
    ];

    // ── Three.js-Objekte ──
    let spriteGroupLeft: THREE.Group;
    let spriteGroupRight: THREE.Group;
    let glowTexture: THREE.CanvasTexture;
    let trailPhasesLeft: number[] = [];
    let trailPhasesRight: number[] = [];

    // ── Deterministischer Zufall ──
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

    function maxSaturate(color: THREE.Color): THREE.Color {
        const hsl = { h: 0, s: 0, l: 0 };
        color.getHSL(hsl);
        if (hsl.l > 0.7 && hsl.s < 0.4) return new THREE.Color(0xffffff);
        return new THREE.Color().setHSL(hsl.h, 1, 0.6);
    }

    /**
     * Baut eine Spur mit ZUFÄLLIGER Richtung (aktuelle Implementierung).
     * Der Startpunkt wird in einem zufälligen Winkel um die Blume gewählt.
     */
    function buildRandomDirectionTrail(
        flowerPos: THREE.Vector3,
        flowerColor: THREE.Color,
        seed: number,
        v: PheromonVariant,
        group: THREE.Group,
    ): number {
        const count = v.particlesPerTrail;
        const positions = new Float32Array(count * 3);
        let rng = seed;

        // ⚠️ Zufällige Richtung (aktuelle Implementierung)
        const angle = seededRandom(rng++) * Math.PI * 2;
        const dist =
            v.trailLengthMin +
            seededRandom(rng++) * (v.trailLengthMax - v.trailLengthMin);
        const startX = flowerPos.x + Math.cos(angle) * dist;
        const startZ = flowerPos.z + Math.sin(angle) * dist;
        const startY = 0.2 + seededRandom(rng++) * 0.6;

        // Kurve von Start → Blume
        const steps = 80;
        const curve: THREE.Vector3[] = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            let x = startX * (1 - t) + flowerPos.x * t;
            let z = startZ * (1 - t) + flowerPos.z * t;
            let y = startY * (1 - t) + flowerPos.y * t;
            const windPhase = angle + t * v.windFrequency;
            const wind = v.windAmplitude * t * (1 - t) * 4;
            x += Math.sin(windPhase) * wind;
            z += Math.cos(windPhase * 0.8) * wind;
            y += Math.sin(windPhase * 1.2) * wind * 0.3;
            curve.push(new THREE.Vector3(x, y, z));
        }

        // Partikel
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
                (seededRandom(rng++) - 0.5) * v.scatterWidth * scatterFactor;
            const ov =
                (seededRandom(rng++) - 0.5) * v.scatterHeight * scatterFactor;
            positions[i * 3] = p.x + perp.x * oh;
            positions[i * 3 + 1] = p.y + ov;
            positions[i * 3 + 2] = p.z + perp.z * oh;
        }

        // Material + Sprites
        const material = new THREE.SpriteMaterial({
            map: glowTexture,
            color: maxSaturate(flowerColor),
            transparent: true,
            opacity: v.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        for (let i = 0; i < count; i++) {
            const sprite = new THREE.Sprite(material);
            sprite.position.set(
                positions[i * 3],
                positions[i * 3 + 1],
                positions[i * 3 + 2],
            );
            sprite.scale.set(v.particleSize, v.particleSize, 1);
            group.add(sprite);
        }

        return seededRandom(rng) * Math.PI * 2;
    }

    /**
     * Baut eine Spur mit Richtung ZUM PLAYER (neue Idee).
     * Der Startpunkt wird entlang der Linie Player → Blume gewählt,
     * sodass die Spur vom Player aus sichtbar ist und zur Blume führt.
     */
    function buildPlayerDirectionTrail(
        flowerPos: THREE.Vector3,
        flowerColor: THREE.Color,
        seed: number,
        v: PheromonVariant,
        group: THREE.Group,
    ): number {
        const count = v.particlesPerTrail;
        const positions = new Float32Array(count * 3);
        let rng = seed;

        // ✅ Richtung: Vom Player zur Blume
        const dirToFlower = new THREE.Vector3().subVectors(
            flowerPos,
            PLAYER_POS,
        );
        const distToFlower = dirToFlower.length();
        dirToFlower.normalize();

        // Die Spur startet zwischen Player und Blume (nah am Player-Ende)
        // trailLengthMin/Max ist der Abstand von der Blume aus gesehen
        const trailDist =
            v.trailLengthMin +
            seededRandom(rng++) * (v.trailLengthMax - v.trailLengthMin);
        // Startpunkt: von der Blume aus in Richtung Player (entgegengesetzt)
        const startPos = new THREE.Vector3()
            .copy(flowerPos)
            .addScaledVector(dirToFlower.clone().negate(), trailDist);
        const startY = 0.2 + seededRandom(rng++) * 0.6;
        startPos.y = startY;

        // Kurve von Start → Blume
        const steps = 80;
        const curve: THREE.Vector3[] = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            let x = startPos.x * (1 - t) + flowerPos.x * t;
            let z = startPos.z * (1 - t) + flowerPos.z * t;
            let y = startPos.y * (1 - t) + flowerPos.y * t;
            const windPhase =
                seededRandom(rng++) * Math.PI * 2 + t * v.windFrequency;
            const wind = v.windAmplitude * t * (1 - t) * 4;
            x += Math.sin(windPhase) * wind;
            z += Math.cos(windPhase * 0.8) * wind;
            y += Math.sin(windPhase * 1.2) * wind * 0.3;
            curve.push(new THREE.Vector3(x, y, z));
        }

        // Partikel
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
                (seededRandom(rng++) - 0.5) * v.scatterWidth * scatterFactor;
            const ov =
                (seededRandom(rng++) - 0.5) * v.scatterHeight * scatterFactor;
            positions[i * 3] = p.x + perp.x * oh;
            positions[i * 3 + 1] = p.y + ov;
            positions[i * 3 + 2] = p.z + perp.z * oh;
        }

        // Material + Sprites
        const material = new THREE.SpriteMaterial({
            map: glowTexture,
            color: maxSaturate(flowerColor),
            transparent: true,
            opacity: v.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        for (let i = 0; i < count; i++) {
            const sprite = new THREE.Sprite(material);
            sprite.position.set(
                positions[i * 3],
                positions[i * 3 + 1],
                positions[i * 3 + 2],
            );
            sprite.scale.set(v.particleSize, v.particleSize, 1);
            group.add(sprite);
        }

        return seededRandom(rng) * Math.PI * 2;
    }

    onMount(async () => {
        try {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x0a1520);

            const w = canvas.clientWidth;
            const h = canvas.clientHeight;

            camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 120);
            // Kamera startet bei (0, 2, 0) – genau wie der Player im Spiel
            camera.position.set(0, 2, 0);
            camera.lookAt(0, 0.5, -20);

            renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
            await renderer.init();
            renderer.setSize(w, h);
            renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

            controls = new OrbitControls(camera, renderer.domElement);
            controls.target.set(0, 0.5, -15);
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

            // Raster
            const grid = new THREE.GridHelper(80, 20, 0x444466, 0x333355);
            grid.position.y = 0.01;
            scene.add(grid);

            // Player-Markierung (kleiner roter Punkt)
            const playerDot = new THREE.Mesh(
                new THREE.SphereGeometry(0.3, 12, 12),
                new THREE.MeshBasicMaterial({ color: 0xff4444 }),
            );
            playerDot.position.copy(PLAYER_POS);
            scene.add(playerDot);

            // Player-Beschriftung (als 3D-Text-Ersatz: ein kleiner Kegel/Pfeil)
            const arrowDir = new THREE.Vector3(0, 0, -1);
            const arrowLen = 1.5;
            const arrowEnd = new THREE.Vector3()
                .copy(PLAYER_POS)
                .addScaledVector(arrowDir, arrowLen);
            const arrowMat = new THREE.MeshBasicMaterial({
                color: 0xff6666,
                transparent: true,
                opacity: 0.6,
            });
            const arrowGeo = new THREE.CylinderGeometry(
                0.05,
                0.05,
                arrowLen,
                4,
            );
            const arrow = new THREE.Mesh(arrowGeo, arrowMat);
            arrow.position
                .copy(PLAYER_POS)
                .add(new THREE.Vector3(0, 0.3, -arrowLen / 2));
            arrow.rotation.x = Math.PI / 2;
            scene.add(arrow);

            // Glow-Textur
            glowTexture = createGlowTexture();

            // ── Linke Gruppe: Zufällige Richtung ──
            spriteGroupLeft = new THREE.Group();
            scene.add(spriteGroupLeft);
            trailPhasesLeft = [];
            for (const f of LEFT_FLOWERS) {
                const phase = buildRandomDirectionTrail(
                    f.pos,
                    f.color,
                    f.seed,
                    TRAIL_VARIANT,
                    spriteGroupLeft,
                );
                trailPhasesLeft.push(phase);
                // Blumen-Markierung
                const sphere = new THREE.Mesh(
                    new THREE.SphereGeometry(0.25, 8, 8),
                    new THREE.MeshBasicMaterial({ color: f.color }),
                );
                sphere.position.copy(f.pos);
                scene.add(sphere);
            }

            // ── Rechte Gruppe: Richtung Player ──
            spriteGroupRight = new THREE.Group();
            scene.add(spriteGroupRight);
            trailPhasesRight = [];
            for (const f of RIGHT_FLOWERS) {
                const phase = buildPlayerDirectionTrail(
                    f.pos,
                    f.color,
                    f.seed,
                    TRAIL_VARIANT,
                    spriteGroupRight,
                );
                trailPhasesRight.push(phase);
                // Blumen-Markierung
                const sphere = new THREE.Mesh(
                    new THREE.SphereGeometry(0.25, 8, 8),
                    new THREE.MeshBasicMaterial({ color: f.color }),
                );
                sphere.position.copy(f.pos);
                scene.add(sphere);
            }

            loading = false;

            // Animation
            const clock = new THREE.Clock();
            function animate() {
                const elapsed = clock.getElapsedTime();
                // Linke Gruppe pulsen
                const leftChildren = spriteGroupLeft.children;
                for (let i = 0; i < leftChildren.length; i++) {
                    const sprite = leftChildren[i];
                    if (
                        sprite instanceof THREE.Sprite &&
                        sprite.material instanceof THREE.SpriteMaterial
                    ) {
                        const trailIdx = Math.min(
                            Math.floor(i / 80),
                            trailPhasesLeft.length - 1,
                        );
                        const phase = trailPhasesLeft[trailIdx] ?? 0;
                        sprite.material.opacity =
                            0.85 *
                            (0.75 + 0.25 * Math.sin(elapsed * 1.5 + phase));
                    }
                }
                // Rechte Gruppe pulsen
                const rightChildren = spriteGroupRight.children;
                for (let i = 0; i < rightChildren.length; i++) {
                    const sprite = rightChildren[i];
                    if (
                        sprite instanceof THREE.Sprite &&
                        sprite.material instanceof THREE.SpriteMaterial
                    ) {
                        const trailIdx = Math.min(
                            Math.floor(i / 80),
                            trailPhasesRight.length - 1,
                        );
                        const phase = trailPhasesRight[trailIdx] ?? 0;
                        sprite.material.opacity =
                            0.85 *
                            (0.75 + 0.25 * Math.sin(elapsed * 1.5 + phase));
                    }
                }
                controls.update();
                renderer.render(scene, camera);
                animationId = requestAnimationFrame(animate);
            }
            animationId = requestAnimationFrame(animate);
        } catch (e) {
            console.error("[Pheromon-Richtung] FEHLER:", e);
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

/** * Testseite: Pheromonspuren – Richtung. * * Zeigt den Unterschied zwischen:
* - Links: Aktuelle Implementierung (zufällige Richtung) * - Rechts: Neue Idee –
Spur zeigt IN RICHTUNG Player * * Der Player (Kamera) startet bei (0, 2, 0) und
schaut nach vorne. * Die Blumen sind 30m entfernt. * * Bei "Richtung Player"
wird die Spur entlang der Linie * Player → Blume platziert, sodass der Player
sie sieht und * ihr zur Blume folgen kann. * * Nutzt WebGPU (WebGPURenderer)
laut Projekt-Vorgabe. */

<div class="container">
    <canvas bind:this={canvas}></canvas>

    <div class="ui-overlay">
        <h1>🧪 Pheromonspuren – Richtungsvergleich</h1>
        {#if loading}<p class="loading">Lade …</p>{/if}
        {#if errorMsg}<p class="error">{errorMsg}</p>{/if}
    </div>

    <!-- Links/Rechts-Beschriftung -->
    <div class="label-left">
        ⚠️ Zufällige Richtung<br /><span class="sub">(aktuell)</span>
    </div>
    <div class="label-right">
        ✅ Richtung Player<br /><span class="sub">(NEU)</span>
    </div>

    <div class="controls">
        <p class="hint">
            🔴 Player startet bei (0, 2, 0) • Blickrichtung nach vorne (⬆️
            Pfeil)<br />
            Blumen sind ~25–30m entfernt • Ziehen zum Drehen • Scrollen zum Zoomen
        </p>
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

    .label-left,
    .label-right {
        position: absolute;
        top: 60px;
        z-index: 10;
        color: white;
        font-size: 1rem;
        font-weight: 700;
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
        text-align: center;
        pointer-events: none;
    }
    .label-left {
        left: 15%;
    }
    .label-right {
        right: 15%;
    }
    .sub {
        font-size: 0.75rem;
        font-weight: 400;
        opacity: 0.6;
    }

    .controls {
        position: absolute;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(10px);
        border-radius: 12px;
        padding: 10px 20px;
        z-index: 10;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .hint {
        color: rgba(255, 255, 255, 0.4);
        font-size: 0.7rem;
        margin: 0;
        line-height: 1.5;
    }
</style>
