<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import * as THREE from "three/webgpu";
    import {
        createGalaxyBiome,
        type GalaxyBiomeSystem,
        type GalaxyVariant,
        VARIANT_META,
    } from "$lib/experiences/space-world/welt/biome/galaxien";

    interface ModeDef {
        id: GalaxyVariant;
        label: string;
        description: string;
    }

    const MODES: ModeDef[] = [
        {
            id: "spiral",
            label: "Spiralgalaxie (Sa)",
            description: "Grand-Design-Spirale mit 4 Armen",
        },
        {
            id: "elliptical",
            label: "Elliptisch (E3)",
            description: "De-Vaucouleurs r¹/⁴ Ellipsoid",
        },
        {
            id: "irregular",
            label: "Irregulär (Im)",
            description: "Magellanic-Typ mit Klumpen + H II",
        },
    ];

    let canvas: HTMLCanvasElement;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderer: any; // THREE.WebGPURenderer
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let galaxy: GalaxyBiomeSystem | null = null;

    let currentMode = $state<GalaxyVariant>("spiral");

    function switchVariant(v: GalaxyVariant): void {
        currentMode = v;
        galaxy?.setVariant(v);
    }

    onMount(() => {
        (async () => {
            const { WebGPURenderer } = await import("three/webgpu");
            renderer = new WebGPURenderer({ canvas, antialias: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setClearColor(0x000508);
            await renderer.init();

            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(
                45,
                window.innerWidth / window.innerHeight,
                0.5,
                3000,
            );

            galaxy = createGalaxyBiome("spiral");
            scene.add(galaxy.group);

            const clock = new THREE.Clock();

            renderer.setAnimationLoop(() => {
                const delta = Math.min(clock.getDelta(), 0.05);
                const elapsed = clock.elapsedTime;

                const orbitRadius = 600;
                const orbitSpeed = 0.06;
                const angle = elapsed * orbitSpeed;
                const tilt = 0.35;

                camera.position.set(
                    Math.cos(angle) * orbitRadius,
                    Math.sin(tilt) * orbitRadius,
                    Math.sin(angle) * orbitRadius,
                );
                camera.lookAt(0, 0, 0);

                galaxy?.update(delta, elapsed);
                renderer.render(scene, camera);
            });

            const onResize = () => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            };
            window.addEventListener("resize", onResize);

            return () => {
                window.removeEventListener("resize", onResize);
            };
        })();
    });

    onDestroy(() => {
        renderer?.setAnimationLoop(null);
        if (galaxy) {
            galaxy.dispose();
            if (scene) scene.remove(galaxy.group);
        }
        renderer?.dispose();
    });
</script>

<svelte:head>
    <title>Galaxien Test — ICAROS VR</title>
</svelte:head>

<div class="ui">
    <div class="panel">
        <h2>🌌 Galaxie-Variante</h2>
        <div class="buttons">
            {#each MODES as mode}
                <button
                    class:active={currentMode === mode.id}
                    onclick={() => {
                        switchVariant(mode.id);
                    }}
                >
                    {mode.label}
                    <span class="desc"> — {mode.description}</span>
                </button>
            {/each}
        </div>
        <div class="info">
            <p>{VARIANT_META[currentMode].desc}</p>
        </div>
    </div>
</div>

<canvas bind:this={canvas} class="canvas"></canvas>

<style>
    :global(body) {
        margin: 0;
        overflow: hidden;
        background: #000508;
        font-family: system-ui, sans-serif;
    }
    .canvas {
        display: block;
        width: 100vw;
        height: 100vh;
    }
    .ui {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10;
        pointer-events: none;
    }
    .panel {
        background: rgba(0, 0, 0, 0.75);
        border: 1px solid rgba(100, 180, 255, 0.25);
        border-radius: 14px;
        padding: 16px 22px;
        color: #ccf;
        pointer-events: auto;
        min-width: 320px;
        backdrop-filter: blur(12px);
    }
    h2 {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        color: #88bbff;
        margin: 0 0 10px;
    }
    .buttons {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    button {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #99aacc;
        padding: 6px 14px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s;
        white-space: nowrap;
    }
    button:hover {
        background: rgba(100, 180, 255, 0.12);
        color: #fff;
        border-color: rgba(100, 180, 255, 0.3);
    }
    button.active {
        background: rgba(100, 180, 255, 0.2);
        border-color: #88bbff;
        color: #fff;
        box-shadow: 0 0 12px rgba(100, 160, 255, 0.15);
    }
    .desc {
        opacity: 0.45;
        font-size: 11px;
    }
    .info {
        margin-top: 10px;
        font-size: 11px;
        opacity: 0.5;
        line-height: 1.5;
    }
    .info p {
        margin: 0;
    }
</style>
