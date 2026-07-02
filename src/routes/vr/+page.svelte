<script lang="ts">
    import { Trophy } from "lucide-svelte";
    import { onDestroy, onMount } from "svelte";
    import * as THREE from "three";
    import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
    import type { ActiveExperience } from "$lib/experiences/loader";
    import {
        getActiveExperienceId,
        loadExperience,
        unloadExperience,
    } from "$lib/experiences/loader";
    import { createWebSocketClient } from "$lib/ws/client.svelte";
    import {
        isOrientationData,
        isSettingsUpdate,
        isSpeedCommand,
    } from "$lib/ws/protocol";

    let canvas: HTMLCanvasElement;
    let renderer: any;
    let scene: THREE.Scene;
    let vrButton: HTMLElement;
    let score = $state(0);
    let experienceName = $state("ICAROS VR");
    let hasOutputs = $state(false);
    let errorMessage = $state("");
    let lastProcessedTimestamp = 0;
    const ws = createWebSocketClient();
    const clock = new THREE.Clock();

    let lastOrientation = { pitch: 0, roll: 0 };
    let lastSpeed = { accelerate: false, brake: false };
    let removeResizeListener: (() => void) | null = null;

    /** Prüft, ob WebGPU im Browser verfügbar ist */
    function hasWebGPU(): boolean {
        return typeof navigator !== "undefined" && "gpu" in navigator;
    }

    onMount(() => {
        scene = new THREE.Scene();
        const dummyCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

        (async () => {
            try {
                // Renderer erstellen: WebGPU wenn verfügbar, sonst WebGL
                if (hasWebGPU()) {
                    console.log("✅ WebGPU erkannt – nutze WebGPURenderer");
                    const { WebGPURenderer } = await import("three/webgpu");
                    renderer = new WebGPURenderer({ canvas, antialias: true });
                } else {
                    console.log(
                        "⚠️ Kein WebGPU – nutze WebGLRenderer als Fallback",
                    );
                    renderer = new THREE.WebGLRenderer({
                        canvas,
                        antialias: true,
                    });
                }

                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.xr.enabled = true;

                // WebGPU braucht init(), WebGL nicht
                if (
                    "init" in renderer &&
                    typeof (renderer as any).init === "function"
                ) {
                    await (renderer as any).init();
                }

                console.log(
                    "✅ Renderer initialisiert, XR:",
                    renderer.xr.enabled,
                );

                vrButton = VRButton.createButton(renderer);
                document.body.appendChild(vrButton);

                const experienceId = getActiveExperienceId();
                console.log("🚀 Lade Experience:", experienceId);

                const exp: ActiveExperience = await loadExperience(
                    experienceId,
                    {
                        scene,
                        camera: dummyCamera,
                        renderer: renderer as any,
                    },
                );

                experienceName = exp.manifest.name;
                hasOutputs = (exp.manifest.outputs?.length ?? 0) > 0;

                const renderCamera =
                    (exp.state.camera as THREE.PerspectiveCamera | undefined) ??
                    dummyCamera;

                /**
                 * Aktualisiert die Kamera-Aspect-Ratio beim Fenster-Resize.
                 * Wird auch beim Start einmal aufgerufen, damit die Kamera
                 * sofort die richtige Perspektive hat (sonst wirkt alles
                 * langgezogen, weil der Initial-Wert 1 ist).
                 */
                function onResize(): void {
                    renderCamera.aspect =
                        window.innerWidth / window.innerHeight;
                    renderCamera.updateProjectionMatrix();
                    renderer.setSize(window.innerWidth, window.innerHeight);
                }
                window.addEventListener("resize", onResize);

                // ✨ Beim Start einmal ausführen, damit die Aspect Ratio
                //    zur Fenstergröße passt und nichts gestreckt aussieht.
                onResize();
                removeResizeListener = () =>
                    window.removeEventListener("resize", onResize);

                renderer.setAnimationLoop(() => {
                    const delta = Math.min(clock.getDelta(), 0.1);

                    const msg = ws.lastMessage;
                    if (msg && msg.timestamp > lastProcessedTimestamp) {
                        lastProcessedTimestamp = msg.timestamp;

                        if (isOrientationData(msg)) {
                            lastOrientation = {
                                pitch: msg.pitch,
                                roll: msg.roll,
                            };
                        }
                        if (isSpeedCommand(msg)) {
                            lastSpeed = {
                                accelerate:
                                    msg.action === "accelerate" && msg.active,
                                brake: msg.action === "brake" && msg.active,
                            };
                        }
                        if (isSettingsUpdate(msg)) {
                            for (const key of Object.keys(msg.settings)) {
                                exp.manifest.applySettings(
                                    key,
                                    msg.settings[key] as
                                        number | boolean | string,
                                    exp.state,
                                    scene,
                                );
                            }
                        }
                    }

                    exp.manifest.updatePlayer(
                        lastOrientation,
                        lastSpeed,
                        exp.state,
                        delta,
                    );
                    const result = exp.manifest.tick(exp.state, {
                        delta,
                        elapsed: clock.elapsedTime,
                        camera: renderCamera,
                        playerPosition:
                            renderCamera.parent?.position ??
                            new THREE.Vector3(),
                        playerRotation:
                            renderCamera.parent?.rotation ?? new THREE.Euler(),
                    });
                    exp.state = result.state;
                    if (result.outputs?.score !== undefined) {
                        score = result.outputs.score as number;
                    }

                    renderer.render(scene, renderCamera);
                });

                console.log("✅ VR bereit!");
            } catch (err) {
                console.error("❌ VR-Fehler:", err);
                errorMessage = String(err);
            }
        })();

        return () => {
            removeResizeListener?.();
        };
    });

    onDestroy(() => {
        renderer?.setAnimationLoop(null);
        if (scene) unloadExperience(scene);
        renderer?.dispose();
        vrButton?.remove();
        ws.disconnect();
    });
</script>

<svelte:head>
    <title>{experienceName} | ICAROS VR</title>
</svelte:head>

<canvas bind:this={canvas} class="vr-canvas"></canvas>

{#if errorMessage}
    <div class="error-overlay">
        <p>Fehler: {errorMessage}</p>
    </div>
{/if}

{#if hasOutputs}
    <div class="score-overlay">
        <Trophy size={20} />
        {score}
    </div>
{/if}

<style>
    .error-overlay {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 0, 0, 0.8);
        color: white;
        padding: 20px;
        border-radius: 8px;
        z-index: 1000;
        max-width: 80vw;
        font-size: 14px;
    }
</style>
