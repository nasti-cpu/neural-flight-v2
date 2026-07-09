<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import * as THREE from "three";
    import {
        createDuneSand,
        disposeDuneSand,
        getSandHeight,
    } from "$lib/experiences/underwater-world v2/Biome/Sand/sand";
    import type { DuneSandResult } from "$lib/experiences/underwater-world v2/Biome/Sand/sand";
    import {
        createSeagrassMeadow,
        disposeSeagrassMeadow,
        updateSeagrassSway,
        initSeagrassSystem,
        SEAGRASS_META,
    } from "$lib/experiences/underwater-world v2/Objekte/Seegras/seagrass";
    import type {
        SeagrassType,
        SeagrassMeadow,
    } from "$lib/experiences/underwater-world v2/Objekte/Seegras/seagrass";
    import {
        loadFishGeometry,
        createProceduralFishGeometry,
    } from "$lib/experiences/underwater-world v2/Objekte/Fische/fish";

    const SCALE_FISHES: {
        label: string;
        color: number;
        pos: [number, number, number];
        scale: number;
    }[] = [
        { label: "klein", color: 0x00cccc, pos: [-15, 1.5, -10], scale: 0.4 },
        { label: "mittel", color: 0xcc8844, pos: [5, 1.5, 8], scale: 0.7 },
        { label: "groß", color: 0xcc66aa, pos: [-5, 1.5, -5], scale: 1.1 },
    ];

    let canvas: HTMLCanvasElement;
    let renderer: THREE.WebGLRenderer;
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let sand: DuneSandResult | null = null;
    let meadow: SeagrassMeadow | null = null;
    let scaleFishes: THREE.Mesh[] = [];
    let fishMaterial: THREE.MeshStandardMaterial;
    let elapsed = 0;

    let currentMode = $state<SeagrassType>("algae");
    let building = $state(false);

    function rebuild(type: SeagrassType): void {
        if (meadow) {
            disposeSeagrassMeadow(meadow, scene);
            meadow = null;
        }
        building = true;
        const m = createSeagrassMeadow(type, getSandHeight);
        meadow = m;
        building = false;
    }

    onMount(async () => {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x002840);

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(
            55,
            window.innerWidth / window.innerHeight,
            0.1,
            500,
        );
        camera.position.set(0, 12, 28);
        camera.lookAt(0, 0, 0);

        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambient);
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(8, 20, 12);
        scene.add(sun);

        sand = createDuneSand();
        scene.add(sand.terrain);

        initSeagrassSystem(scene);

        meadow = createSeagrassMeadow("algae", getSandHeight);

        // Try loading the GLTF fish model (same as VR), fall back to procedural
        const modelGeo =
            (await loadFishGeometry()) ?? createProceduralFishGeometry();

        // Add 3 scale-reference fish using the same model as VR v2
        fishMaterial = new THREE.MeshStandardMaterial({
            roughness: 0.3,
            metalness: 0.1,
            flatShading: true,
            emissive: new THREE.Color(0x004466),
            emissiveIntensity: 0.4,
        });
        for (const sf of SCALE_FISHES) {
            const mat = fishMaterial.clone();
            mat.color.set(sf.color);
            const mesh = new THREE.Mesh(modelGeo, mat);
            mesh.position.set(
                sf.pos[0],
                getSandHeight(sf.pos[0], sf.pos[2]) + sf.pos[1],
                sf.pos[2],
            );
            mesh.scale.setScalar(sf.scale);
            mesh.rotation.y = 0.3;
            scene.add(mesh);
            scaleFishes.push(mesh);
        }

        renderer.setAnimationLoop(() => {
            elapsed += 0.016;
            camera.position.set(0, 12, 28);
            camera.lookAt(0, 0, 0);
            if (meadow) updateSeagrassSway(meadow, elapsed, currentMode);
            // Gentle fish bob
            for (const m of scaleFishes) {
                m.position.y =
                    getSandHeight(m.position.x, m.position.z) +
                    1.5 +
                    Math.sin(elapsed * 2 + m.position.x) * 0.3;
                m.rotation.z = Math.sin(elapsed * 1.5 + m.position.z) * 0.08;
            }
            renderer.render(scene, camera);
        });
    });

    onDestroy(() => {
        renderer?.setAnimationLoop(null);
        if (meadow) disposeSeagrassMeadow(meadow, scene);
        if (sand) disposeDuneSand(sand, scene);
        for (const m of scaleFishes) {
            scene.remove(m);
            m.geometry.dispose();
            (m.material as THREE.Material).dispose();
        }
        fishMaterial.dispose();
        renderer?.dispose();
    });
</script>

<svelte:head>
    <title>Seegras — ICAROS VR</title>
</svelte:head>

<div class="ui">
    <div class="panel">
        <h2>Seegras-Wiese</h2>
        <div class="buttons">
            {#each SEAGRASS_META as mode}
                <button
                    class:active={currentMode === mode.id}
                    disabled={building}
                    onclick={() => {
                        currentMode = mode.id;
                        rebuild(mode.id);
                    }}
                    >{mode.label}<span class="desc">
                        — {mode.description}</span
                    ></button
                >
            {/each}
        </div>
    </div>
</div>

<canvas bind:this={canvas} class="canvas"></canvas>

<style>
    :global(body) {
        margin: 0;
        overflow: hidden;
        background: #002840;
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
    }
    .panel {
        background: rgba(0, 0, 0, 0.7);
        border: 1px solid rgba(0, 170, 255, 0.3);
        border-radius: 12px;
        padding: 16px 20px;
        color: #ccf;
        pointer-events: auto;
        min-width: 280px;
    }
    h2 {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #00aaff;
        margin: 0 0 8px;
    }
    .buttons {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    button {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #aac;
        padding: 5px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.15s;
    }
    button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    button:hover:not(:disabled) {
        background: rgba(0, 170, 255, 0.15);
        color: #fff;
    }
    button.active {
        background: rgba(0, 170, 255, 0.25);
        border-color: #00aaff;
        color: #fff;
    }
    .desc {
        opacity: 0.5;
        font-size: 11px;
    }
</style>
