<script lang="ts">

    import { onDestroy, onMount } from "svelte";
    import * as THREE from "three/webgpu";
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
    import { FPSMonitor } from "$lib/experiences/insect-world-v2/Sinne/FPSMonitor";

    let canvas: HTMLCanvasElement;
    let renderer: THREE.WebGPURenderer;
    let scene: THREE.Scene;
    let vrButton: HTMLElement;
    let experienceName = $state("ICAROS VR");
    let lastProcessedTimestamp = 0;
    const ws = createWebSocketClient();
    const clock = new THREE.Clock();
    let fpsMonitor: FPSMonitor;

    let lastOrientation = { pitch: 0, roll: 0 };
    let lastSpeed = { accelerate: false, brake: false };
    let removeResizeListener: (() => void) | null = null;
    const keys = {
        w: false,
        a: false,
        s: false,
        d: false,
        shift: false,
        ctrl: false,
    };

    onMount(() => {
        scene = new THREE.Scene();
        const dummyCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);

        renderer = new THREE.WebGPURenderer({ canvas, antialias: true });

        (async () => {
            await renderer.init();
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.xr.enabled = true;
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;

            // XR-Session-Fehler abfangen (z.B. WebGPU+XR nicht unterstützt)
            renderer.xr.addEventListener("sessionstart", () => {
                console.log("[VR] XR-Session gestartet");
            });
            renderer.xr.addEventListener("sessionend", () => {
                console.log("[VR] XR-Session beendet");
            });
            renderer.xr.addEventListener("sessionerror" as any, (e: any) => {
                console.error("[VR] XR-Session-Fehler:", e);
            });

            vrButton = VRButton.createButton(renderer);
            document.body.appendChild(vrButton);

            function onKey(e: KeyboardEvent, pressed: boolean) {
                switch (e.code) {
                    case "KeyW":
                        keys.w = pressed;
                        break;
                    case "KeyA":
                        keys.a = pressed;
                        break;
                    case "KeyS":
                        keys.s = pressed;
                        break;
                    case "KeyD":
                        keys.d = pressed;
                        break;
                    case "ShiftLeft":
                    case "ShiftRight":
                        keys.shift = pressed;
                        break;
                    case "ControlLeft":
                    case "ControlRight":
                        keys.ctrl = pressed;
                        break;
                }
            }
            addEventListener("keydown", (e) => onKey(e, true));
            addEventListener("keyup", (e) => onKey(e, false));

            // Load whichever experience is selected (persisted in localStorage)
            const experienceId = getActiveExperienceId();

            loadExperience(experienceId, {
                scene,
                camera: dummyCamera,
                renderer: renderer as any,
            })
                .then((exp: ActiveExperience) => {
                    experienceName = exp.manifest.name;
                    fpsMonitor = new FPSMonitor();
                    fpsMonitor.start();

                    const renderCamera = exp.state
                        .camera as THREE.PerspectiveCamera;

                    function onResize(): void {
                        renderCamera.aspect =
                            window.innerWidth / window.innerHeight;
                        renderCamera.updateProjectionMatrix();
                        renderer.setSize(window.innerWidth, window.innerHeight);
                    }
                    window.addEventListener("resize", onResize);
                    removeResizeListener = () =>
                        window.removeEventListener("resize", onResize);

                    renderer.setAnimationLoop((timestamp: number) => {
                        fpsMonitor.update(timestamp);
                        // delta = Zeit seit letztem Frame in Sekunden.
                        // Nach Tab-Wechsel oder VR-Session-Start kann delta
                        // riesig werden (>1s). Wir deckeln es auf 0.1s,
                        // damit der Spieler nicht plötzlich 100m weit fliegt.
                        const delta = Math.min(clock.getDelta(), 0.1);

                        // In VR zeigt die Brille zwei leicht versetzte Bilder
                        // (eins pro Auge). Three.js verwaltet dafür eine eigene
                        // XR-Kamera. Wir MÜSSEN sie nutzen, sonst sehen wir
                        // in der Brille nichts.
                        const activeCam = renderer.xr.isPresenting
                            ? (renderer.xr.getCamera() as THREE.PerspectiveCamera)
                            : renderCamera;

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
                                        msg.action === "accelerate" &&
                                        msg.active,
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

                        // Tastatur-Steuerung nur im Desktop-Modus (nicht während VR-Session)
                        if (!renderer.xr.isPresenting) {
                            const kPitch =
                                (keys.w ? -30 : 0) + (keys.s ? 30 : 0);
                            const kRoll =
                                (keys.a ? -30 : 0) + (keys.d ? 30 : 0);
                            if (kPitch !== 0 || kRoll !== 0) {
                                lastOrientation = {
                                    pitch: kPitch,
                                    roll: kRoll,
                                };
                            }
                            if (keys.shift) {
                                lastSpeed = { accelerate: true, brake: false };
                            } else if (keys.ctrl) {
                                lastSpeed = { accelerate: false, brake: true };
                            } else if (kPitch === 0 && kRoll === 0) {
                                lastSpeed = { accelerate: false, brake: false };
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
                            camera: activeCam,
                            playerPosition:
                                activeCam.parent?.position ??
                                new THREE.Vector3(),
                            playerRotation:
                                activeCam.parent?.rotation ?? new THREE.Euler(),
                        });
                        exp.state = result.state;
                        renderer.render(scene, activeCam);
                    });
                })
                .catch((err: unknown) => {
                    console.error("Failed to load experience:", err);
                    experienceName =
                        "Error: " +
                        (err instanceof Error ? err.message : String(err));
                });
        })();

        return () => {
            removeResizeListener?.();
        };
    });

    onDestroy(() => {
        fpsMonitor?.stop();
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

