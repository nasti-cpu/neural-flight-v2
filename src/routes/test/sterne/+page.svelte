<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import * as THREE from "three/webgpu";
    import {
        createStarBiome,
        VARIANT_META,
        type StarVariant,
        type StarBiomeSystem,
    } from "$lib/experiences/space-world/welt/biome/sterne";

    let canvas: HTMLCanvasElement;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderer: any; // THREE.WebGPURenderer
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let clock = new THREE.Clock();
    let biome: StarBiomeSystem | null = null;

    let currentVariant = $state<StarVariant>("classic");
    let flySpeed = $state(15);
    let showUI = $state(true);

    onMount(() => {
        (async () => {
            const { WebGPURenderer } = await import("three/webgpu");
            renderer = new WebGPURenderer({ canvas, antialias: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setClearColor(0x000011);
            await renderer.init();

            scene = new THREE.Scene();
            scene.fog = new THREE.FogExp2(0x000011, 0.00008);

            camera = new THREE.PerspectiveCamera(
                70,
                window.innerWidth / window.innerHeight,
                0.1,
                2000,
            );
            camera.position.set(0, 10, 0);

            biome = createStarBiome("classic");
            scene.add(biome.group);

            renderer.setAnimationLoop(() => {
                const delta = Math.min(clock.getDelta(), 0.1);
                const elapsed = clock.elapsedTime;

                const z = camera.position.z - flySpeed * delta;
                const x = Math.sin(elapsed * 0.15) * 30;
                const y = 10 + Math.sin(elapsed * 0.22) * 25;

                camera.position.set(x, y, z);

                const lookZ = z - 40;
                const lookX = Math.sin(elapsed * 0.18) * 15;
                const lookY = 10 + Math.sin(elapsed * 0.25) * 10;
                camera.lookAt(lookX, lookY, lookZ);

                if (biome) {
                    biome.group.position.copy(camera.position);
                    biome.update(delta, elapsed);
                }

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
        biome?.dispose();
        renderer?.dispose();
    });

    function switchVariant(v: StarVariant) {
        currentVariant = v;
        biome?.setVariant(v);
    }

    const variantKeys: StarVariant[] = ["classic", "milky", "nebula"];
</script>

<svelte:head>
    <title>Sterne Biome Test — ICAROS VR</title>
</svelte:head>

<div class="ui" class:hidden={!showUI}>
    <div class="panel">
        <h2>Sternen-Biome</h2>
        <p class="subtitle">
            Wähle eine Variante &mdash; du fliegst automatisch hindurch
        </p>

        <div class="buttons">
            {#each variantKeys as vk}
                <button
                    class:active={currentVariant === vk}
                    onclick={() => switchVariant(vk)}
                >
                    {VARIANT_META[vk].label}
                </button>
            {/each}
        </div>

        <div class="desc">
            {VARIANT_META[currentVariant].desc}
        </div>

        <hr />

        <div class="controls">
            <label>
                <span>Fluggeschwindigkeit: {flySpeed}</span>
                <input
                    type="range"
                    min="3"
                    max="60"
                    step="1"
                    bind:value={flySpeed}
                />
            </label>
        </div>
    </div>

    <button class="toggle-ui" onclick={() => (showUI = !showUI)}>
        {showUI ? "UI ausblenden" : "UI einblenden"}
    </button>
</div>

<canvas bind:this={canvas} class="canvas"></canvas>

<style>
    :global(body) {
        margin: 0;
        overflow: hidden;
        background: #000011;
        font-family: system-ui, sans-serif;
    }
    .canvas {
        display: block;
        width: 100vw;
        height: 100vh;
    }

    .ui {
        position: fixed;
        top: 16px;
        left: 16px;
        z-index: 10;
        pointer-events: none;
        transition: opacity 0.3s;
    }
    .ui.hidden {
        opacity: 0.15;
    }
    .ui.hidden:hover {
        opacity: 1;
    }

    .panel {
        background: rgba(5, 5, 30, 0.8);
        border: 1px solid rgba(100, 140, 255, 0.25);
        border-radius: 14px;
        padding: 20px 24px;
        color: #ccddff;
        pointer-events: auto;
        min-width: 280px;
        max-width: 350px;
        backdrop-filter: blur(12px);
    }

    h2 {
        font-size: 15px;
        text-transform: uppercase;
        letter-spacing: 2px;
        color: #88aaff;
        margin: 0 0 4px;
    }
    .subtitle {
        font-size: 11px;
        color: #667799;
        margin: 0 0 14px;
    }

    .buttons {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 12px;
    }
    button {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #99aacc;
        padding: 6px 14px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
    }
    button:hover {
        background: rgba(80, 120, 255, 0.18);
        color: #fff;
        border-color: rgba(80, 120, 255, 0.4);
    }
    button.active {
        background: rgba(80, 120, 255, 0.3);
        border-color: #6688dd;
        color: #fff;
        box-shadow: 0 0 12px rgba(80, 120, 255, 0.25);
    }

    .desc {
        font-size: 12px;
        line-height: 1.5;
        color: #8899bb;
        margin-bottom: 8px;
    }

    hr {
        border: none;
        border-top: 1px solid rgba(100, 140, 255, 0.12);
        margin: 12px 0;
    }

    .controls {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .controls label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: #8899bb;
    }
    .controls input[type="range"] {
        width: 100%;
        accent-color: #6688dd;
    }

    .toggle-ui {
        position: fixed;
        bottom: 16px;
        left: 16px;
        pointer-events: auto;
        font-size: 11px;
        padding: 5px 12px;
        background: rgba(5, 5, 30, 0.6);
        border: 1px solid rgba(100, 140, 255, 0.15);
        border-radius: 6px;
        color: #667799;
        cursor: pointer;
    }
    .toggle-ui:hover {
        color: #aaccff;
        border-color: rgba(100, 140, 255, 0.35);
    }
</style>
