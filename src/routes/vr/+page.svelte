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
    // import { FpsCounter } from "$lib/three/fps-counter";
    import { createWebSocketClient } from "$lib/ws/client.svelte";
    import {
        isOrientationData,
        isSettingsUpdate,
        isSpeedCommand,
    } from "$lib/ws/protocol";
    import {
        createIcarosHostIntegration,
        getClientId,
        type IcarosHostIntegration,
    } from "$lib/icaros";

    let canvas: HTMLCanvasElement;
    let renderer: any;
    let scene: THREE.Scene;
    let vrButton: HTMLElement;
    let score = $state(0);
    let experienceName = $state("ICAROS VR");
    let hasOutputs = $state(false);
    let errorMessage = $state("");
    let lastProcessedTimestamp = 0;

    // ── Lokaler WebSocket-Client (für lokales Controller-Verhalten) ──
    const ws = createWebSocketClient();

    // ── ICAROS Host Integration (falls PUBLIC_ICAROS_HOST_ORIGIN gesetzt) ──
    let icarosHost: IcarosHostIntegration | null = null;

    const clock = new THREE.Clock();

    let lastOrientation = { pitch: 0, roll: 0 };
    let lastSpeed = { accelerate: false, brake: false };
    let removeResizeListener: (() => void) | null = null;
    let removeKeyListener: (() => void) | null = null;
    // let fpsCounter: FpsCounter | null = null;

    /**
     * ICAROS Host-Integration starten, wenn PUBLIC_ICAROS_HOST_ORIGIN gesetzt ist.
     *
     * Verwendet die tatsächlich geladene Experience-ID und den Namen –
     * NICHT den localStorage-Wert. Der localStorage kann einen alten
     * Default enthalten, wenn die VR-Seite direkt (z. B. vom Host)
     * geöffnet wird, ohne die Landing Page vorher besucht zu haben.
     */
    function startIcarosHost(experienceId: string, title: string): void {
        icarosHost = createIcarosHostIntegration({
            clientId: getClientId(),
            experienceId,
            title,
            onOrientation: (input) => {
                // ICAROS Host liefert pitch/roll – direkt in lastOrientation
                lastOrientation = { pitch: input.pitch, roll: input.roll };
            },
        });

        if (icarosHost.active) {
            console.log("[ICAROS] Host-Integration aktiv – lokaler WS wird ignoriert");
        }
    }

    onMount(() => {
        scene = new THREE.Scene();
        const dummyCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

        (async () => {
            try {
                // WebGPURenderer wird für die TSL/NodeMaterial-Shader der
                // Experiences benötigt. Three.js unterstützt WebXR aber nicht
                // mit einem echten WebGPU-Backend (wirft in XRManager.js einen
                // Fehler) – forceWebGL lässt den WebGPURenderer intern über
                // WebGL2 laufen, das die WebXR-Pipeline unterstützt, während
                // TSL-Shader weiterhin kompiliert werden.
                console.log(
                    "✅ Nutze WebGPURenderer (forceWebGL) für WebXR-Kompatibilität",
                );
                const { WebGPURenderer } = await import("three/webgpu");
                renderer = new WebGPURenderer({
                    canvas,
                    antialias: true,
                    forceWebGL: true,
                });

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

                // fpsCounter = new FpsCounter();

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

                // ICAROS Host-Integration starten mit der TATSÄCHLICH geladenen Experience
                // (nicht aus localStorage – der könnte veraltet sein)
                startIcarosHost(exp.manifest.id, exp.manifest.name);

                /**
                 * Gibt die aktuelle Render-Kamera zurück.
                 * Die Erfahrung kann die Kamera während der Laufzeit wechseln
                 * (z. B. Beyond‑Limits: FlightPlayer → DummyCamera beim Portal‑Übergang).
                 * Daher muss die Kamera JEDEN Frame frisch aus dem State gelesen werden.
                 */
                function getRenderCamera(): THREE.PerspectiveCamera {
                    return (exp.state.camera as THREE.PerspectiveCamera | undefined) ??
                        dummyCamera;
                }

                /**
                 * Aktualisiert die Kamera-Aspect-Ratio beim Fenster-Resize.
                 * Liest die Kamera jeden Aufruf frisch (siehe getRenderCamera).
                 */
                function onResize(): void {
                    const cam = getRenderCamera();
                    cam.aspect =
                        window.innerWidth / window.innerHeight;
                    cam.updateProjectionMatrix();
                    renderer.setSize(window.innerWidth, window.innerHeight);
                }
                window.addEventListener("resize", onResize);

                // ✨ Beim Start einmal ausführen, damit die Aspect Ratio
                //    zur Fenstergröße passt und nichts gestreckt aussieht.
                onResize();
                removeResizeListener = () =>
                    window.removeEventListener("resize", onResize);

                // ── P-Taste: Portal-Transition manuell auslösen ──
                // Einmal drücken = Portal erscheint, nochmal = sofortiger Wechsel
                function onKeyDown(e: KeyboardEvent): void {
                    if (e.code === "KeyP" && exp.state) {
                        (exp.state as Record<string, unknown>)._forcePortal = true;
                    }
                }
                window.addEventListener("keydown", onKeyDown);
                removeKeyListener = () =>
                    window.removeEventListener("keydown", onKeyDown);

                renderer.setAnimationLoop(() => {
                    const delta = Math.min(clock.getDelta(), 0.1);
                    const cam = getRenderCamera();

                    // ── ICAROS Host-Orientierung wird über onOrientation-Callback
                    //    direkt in lastOrientation geschrieben. Der lokale WS-Client
                    //    wird nur verwendet, wenn kein Host aktiv ist.

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
                        camera: cam,
                        playerPosition:
                            cam.parent?.position ??
                            new THREE.Vector3(),
                        playerRotation:
                            cam.parent?.rotation ?? new THREE.Euler(),
                    });
                    exp.state = result.state;
                    if (result.outputs?.score !== undefined) {
                        score = result.outputs.score as number;
                    }

                    // fpsCounter?.update();
                    renderer.render(scene, cam);
                });

                console.log("✅ VR bereit!");
            } catch (err) {
                console.error("❌ VR-Fehler:", err);
                errorMessage = String(err);
            }
        })();

        return () => {
            removeResizeListener?.();
            removeKeyListener?.();
        };
    });

    onDestroy(() => {
        // fpsCounter?.dispose();
        renderer?.setAnimationLoop(null);
        if (scene) unloadExperience(scene);
        renderer?.dispose();
        vrButton?.remove();
        ws.disconnect();
        // ICAROS Host-Verbindungen sauber trennen
        icarosHost?.destroy();
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