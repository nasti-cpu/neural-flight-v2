/**
 * Testseite: City Guide Path – 4 Varianten.
 *
 * Zeigt einen leuchtenden Neon-Pfad vom Player zur nächsten Stadt.
 * 4 Varianten zum Vergleichen:
 *   A – Dünne Neonlinie (LineBasicMaterial)
 *   B – Dicke Leuchtröhre (TubeGeometry)
 *   C – Mehrere parallele Linien
 *   D – Gestrichelte Neonlinie (LineDashedMaterial)
 *
 * WebGPU + OrbitControls.
 */
<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { browser } from "$app/environment";
	import * as THREE from "three/webgpu";
	import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

	import { createSky } from "$lib/experiences/insect-world-v2/Biome/blauerHimmel/sky";
	import TestNav from "$lib/components/TestNav.svelte";

	type VariantKey = "A" | "B" | "C" | "D" | "E";

	interface Variant {
		key: VariantKey;
		name: string;
		desc: string;
	}

	const VARIANTS: Variant[] = [
		{ key: "A", name: "Dünne Neonlinie", desc: "LineBasicMaterial, additive" },
		{ key: "B", name: "Dicke Leuchtröhre", desc: "TubeGeometry, leuchtend" },
		{ key: "C", name: "Parallele Linien", desc: "3 nebeneinander" },
		{ key: "D", name: "Gestrichelt (discret)", desc: "LineDashedMaterial" },
		{ key: "E", name: "✨ Glowy-Dashed (NEON)", desc: "Sprite-Glow an Dash-Positionen wie Pheromonspuren" },
	];

	// ── Stadt-Positionen (prozedural, 200–300m Abstand simuliert) ──
	const CITIES = [
		{ pos: new THREE.Vector3(0, 0, -80), label: "Stadt A", visited: false },
		{ pos: new THREE.Vector3(60, 0, -40), label: "Stadt B", visited: false },
		{ pos: new THREE.Vector3(-50, 0, -70), label: "Stadt C", visited: false },
		{ pos: new THREE.Vector3(30, 0, 60), label: "Stadt D", visited: false },
	];

	const PLAYER_POS = new THREE.Vector3(0, 2, 0);

	const NEON_COLOR = new THREE.Color(0x00ffff);
	const NEON_INTENSITY = 2.0;

	// ── Reactive State ──
	let canvas: HTMLCanvasElement;
	let renderer: THREE.WebGPURenderer;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let animationId: number;
	let errorMsg = $state("");
	let loading = $state(true);

	let activeVariant = $state<VariantKey>("A");
	let pathGroup = new THREE.Group();
	let cityMeshes: THREE.Mesh[] = [];

	// Boden-Höhenfunktion (sanfte Mulde)
	function getHeight(x: number, z: number): number {
		const dist = Math.sqrt(x * x + z * z);
		return -0.00008 * dist * dist;
	}

	// ── Pfad-Kurve von Player zur Stadt ──
	function buildPathPoints(
		from: THREE.Vector3,
		to: THREE.Vector3,
		numPoints = 60,
	): THREE.Vector3[] {
		const pts: THREE.Vector3[] = [];
		const dx = to.x - from.x;
		const dz = to.z - from.z;
		const dist = Math.sqrt(dx * dx + dz * dz);

		// Mittelpunkt leicht versetzt für sanfte Kurve
		const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * dist * 0.15;
		const midZ = (from.z + to.z) / 2 + (Math.random() - 0.5) * dist * 0.15;
		const midY =
			(getHeight(from.x, from.z) +
				getHeight(to.x, to.z) +
				getHeight(midX, midZ)) /
				3 +
			1.5;

		// Kontrollpunkte für CatmullRom-Spline
		const ctrlPts = [
			new THREE.Vector3(from.x, getHeight(from.x, from.z) + 1.2, from.z),
			new THREE.Vector3(midX, midY, midZ),
			new THREE.Vector3(to.x, getHeight(to.x, to.z) + 0.8, to.z),
		];

		const curve = new THREE.CatmullRomCurve3(ctrlPts);

		for (let i = 0; i <= numPoints; i++) {
			const t = i / numPoints;
			const p = curve.getPoint(t);
			// Geländehöhe anpassen (Pfad schwebt ~0.5–1.5m über Boden)
			const groundY = getHeight(p.x, p.z);
			const heightAbove = 0.5 + Math.sin(t * Math.PI) * 1.0;
			p.y = groundY + heightAbove;
			pts.push(p);
		}
		return pts;
	}

	// ── Variante A: Dünne Neonlinie ──
	function buildVariantA(points: THREE.Vector3[]): THREE.Line {
		const geo = new THREE.BufferGeometry().setFromPoints(points);
		const mat = new THREE.LineBasicMaterial({
			color: NEON_COLOR,
			transparent: true,
			opacity: 0.9,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			linewidth: 1,
		});
		return new THREE.Line(geo, mat);
	}

	// ── Variante B: Dicke Leuchtröhre (TubeGeometry) ──
	function buildVariantB(points: THREE.Vector3[]): THREE.Mesh {
		const curve = new THREE.CatmullRomCurve3(points);
		const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.25, 8, false);
		const mat = new THREE.MeshBasicMaterial({
			color: NEON_COLOR,
			transparent: true,
			opacity: 0.85,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		return new THREE.Mesh(tubeGeo, mat);
	}

	// ── Variante C: 3 parallele Linien ──
	function buildVariantC(points: THREE.Vector3[]): THREE.Group {
		const group = new THREE.Group();
		const mat = new THREE.LineBasicMaterial({
			color: NEON_COLOR,
			transparent: true,
			opacity: 0.7,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});

		// 3 parallele Linien mit je 0.4m Abstand
		for (let offset = -0.4; offset <= 0.4; offset += 0.4) {
			const pts = points.map((p) => {
				// Seitlicher Versatz senkrecht zur Pfad-Richtung
				return new THREE.Vector3(p.x + offset, p.y, p.z + offset * 0.5);
			});
			const geo = new THREE.BufferGeometry().setFromPoints(pts);
			const line = new THREE.Line(geo, mat.clone());
			line.material.opacity = 0.7 - Math.abs(offset) * 0.3;
			group.add(line);
		}
		return group;
	}

	// ── Glow-Textur (wie Pheromonspuren) ──
	let glowTexture: THREE.CanvasTexture;

	function createGlowTexture(): THREE.CanvasTexture {
		const size = 64;
		const canvas = document.createElement("canvas");
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext("2d")!;
		const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		g.addColorStop(0, "rgba(255,255,255,1)");
		g.addColorStop(0.08, "rgba(255,255,255,0.9)");
		g.addColorStop(0.25, "rgba(255,255,255,0.5)");
		g.addColorStop(0.5, "rgba(255,255,255,0.15)");
		g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, size, size);
		const tex = new THREE.CanvasTexture(canvas);
		tex.needsUpdate = true;
		return tex;
	}

	// ── Variante D: Gestrichelte Neonlinie ──
	function buildVariantD(points: THREE.Vector3[]): THREE.Line {
		const geo = new THREE.BufferGeometry().setFromPoints(points);
		const mat = new THREE.LineDashedMaterial({
			color: NEON_COLOR,
			dashSize: 0.8,
			gapSize: 0.4,
			transparent: true,
			opacity: 0.9,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
		const line = new THREE.Line(geo, mat);
		line.computeLineDistances();
		return line;
	}

	// ── Variante E: Glowy-Dashed (Sprite-Glow wie Pheromonspuren) ──
	function buildVariantE(points: THREE.Vector3[]): THREE.Group {
		const group = new THREE.Group();

		const mat = new THREE.SpriteMaterial({
			map: glowTexture,
			color: NEON_COLOR,
			transparent: true,
			opacity: 0.95,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});

		// Gesamtlänge der Kurve berechnen
		let totalLength = 0;
		for (let i = 1; i < points.length; i++) {
			totalLength += points[i].distanceTo(points[i - 1]);
		}

		const dashLen = 1.2;
		const gapLen = 0.6;
		const segmentLen = dashLen + gapLen;
		const numDashes = Math.floor(totalLength / segmentLen);

		// Position entlang der Kurve sampeln
		let accumulated = 0;
		let dashIdx = 0;
		for (let i = 1; i < points.length && dashIdx < numDashes; i++) {
			const segLen = points[i].distanceTo(points[i - 1]);
			const startAcc = accumulated;
			accumulated += segLen;

			const dashStart = dashIdx * segmentLen;
			const dashEnd = dashStart + dashLen;

			// Überschneidet dieses Segment den aktuellen Dash?
			const segStart = startAcc;
			const segEnd = accumulated;

			if (segEnd < dashStart) continue;
			if (segStart > dashEnd) { dashIdx++; i--; continue; }

			// Position im Dash
			const localT = (Math.max(segStart, dashStart) - dashStart) / dashLen;
			const t = (Math.max(segStart, dashStart) - startAcc) / segLen;
			const p = new THREE.Vector3().lerpVectors(points[i - 1], points[i], Math.max(0, Math.min(1, t)));

			// Richtung für Rotation
			const dir = new THREE.Vector3().subVectors(points[i], points[i - 1]).normalize();

			// Mehrere Sprites pro Dash für dichten Glow
			const spritesPerDash = 8;
			for (let s = 0; s < spritesPerDash; s++) {
				const offset = (s / spritesPerDash) * dashLen * 0.8;
				const pos = new THREE.Vector3().copy(p);

				// Entlang der Dash-Richtung verschieben
				const forward = new THREE.Vector3().copy(dir).multiplyScalar(offset);
				pos.add(forward);

				// Leichte zufällige Streuung für organischen Look
				pos.x += (Math.random() - 0.5) * 0.2;
				pos.z += (Math.random() - 0.5) * 0.2;
				pos.y += (Math.random() - 0.5) * 0.1;

				const sprite = new THREE.Sprite(mat);
				sprite.position.copy(pos);
				const size = 0.35 + Math.random() * 0.25;
				sprite.scale.set(size, size, 1);
				sprite.userData.phase = Math.random() * Math.PI * 2;
				group.add(sprite);
			}

			if (segEnd > dashEnd) dashIdx++;
		}

		return group;
	}

	// ── Pfad neu bauen zur nächsten unbesuchten Stadt ──
	function buildPath() {
		// Alten Pfad entfernen
		while (pathGroup.children.length > 0) {
			const child = pathGroup.children[0];
			if (child instanceof THREE.Mesh) {
				child.geometry.dispose();
				child.material.dispose();
			}
			if (child instanceof THREE.Line) {
				child.geometry.dispose();
				child.material.dispose();
			}
			if (child instanceof THREE.Group) {
				child.traverse((c) => {
					if (c instanceof THREE.Mesh || c instanceof THREE.Line || c instanceof THREE.Sprite) {
						c.geometry?.dispose();
						if (c.material) (c.material as THREE.Material).dispose();
					}
				});
			}
			if (child instanceof THREE.Sprite) {
				child.material.dispose();
			}
			pathGroup.remove(child);
		}

		// Nächste unbesuchte Stadt finden
		let nearest: (typeof CITIES)[0] | null = null;
		let nearestDist = Infinity;
		for (const city of CITIES) {
			if (city.visited) continue;
			const dist = PLAYER_POS.distanceTo(city.pos);
			if (dist < nearestDist) {
				nearestDist = dist;
				nearest = city;
			}
		}

		if (!nearest) {
			// Alle Städte besucht → Pfad zur nächsten (wiederholt)
			// Einfach erste Stadt
			CITIES[0].visited = false;
			buildPath();
			return;
		}

		const points = buildPathPoints(PLAYER_POS, nearest.pos);

		let obj: THREE.Object3D;
		switch (activeVariant) {
			case "A":
				obj = buildVariantA(points);
				break;
			case "B":
				obj = buildVariantB(points);
				break;
			case "C":
				obj = buildVariantC(points);
				break;
			case "D":
				obj = buildVariantD(points);
				break;
			case "E":
				obj = buildVariantE(points);
				break;
		}
		pathGroup.add(obj);
	}

	// ── Prüfen ob der Player eine Stadt erreicht hat ──
	function checkCityReached(): boolean {
		let reached = false;
		for (const city of CITIES) {
			if (city.visited) continue;
			const dist = PLAYER_POS.distanceTo(city.pos);
			// Stadt erreicht bei < 15m
			if (dist < 15) {
				city.visited = true;
				reached = true;
				// Stadt-Mesh grün färben
				for (const mesh of cityMeshes) {
					if (mesh.userData.cityLabel === city.label) {
						(mesh.material as THREE.MeshBasicMaterial).color.setHex(0x44cc44);
					}
				}
			}
		}
		return reached;
	}

	onMount(async () => {
		try {
			scene = new THREE.Scene();
			scene.background = new THREE.Color(0x0a1520);

			const w = canvas.clientWidth;
			const h = canvas.clientHeight;

			camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500);
			camera.position.set(0, 30, 60);
			camera.lookAt(0, 0, -20);

			renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
			await renderer.init();
			renderer.setSize(w, h);
			renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

			controls = new OrbitControls(camera, renderer.domElement);
			controls.target.set(0, 0, -20);
			controls.update();

			// Licht
			const ambient = new THREE.AmbientLight(0x445566, 0.4);
			scene.add(ambient);
			const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
			sun.position.set(30, 50, 20);
			scene.add(sun);

			// Himmel
			const sky = createSky("tief");
			scene.add(sky);

			// Boden (größere Fläche)
			const groundGeo = new THREE.PlaneGeometry(300, 300);
			const groundMat = new THREE.MeshBasicMaterial({
				color: 0x1a2a1a,
				side: THREE.DoubleSide,
			});
			const ground = new THREE.Mesh(groundGeo, groundMat);
			ground.rotation.x = -Math.PI / 2;
			scene.add(ground);

			// Raster
			const grid = new THREE.GridHelper(250, 30, 0x333366, 0x222244);
			grid.position.y = 0.02;
			scene.add(grid);

			// Player-Markierung (roter Punkt + Kegel als Richtungsanzeiger)
			const playerDot = new THREE.Mesh(
				new THREE.SphereGeometry(0.5, 12, 12),
				new THREE.MeshBasicMaterial({ color: 0xff4444 }),
			);
			playerDot.position.copy(PLAYER_POS);
			scene.add(playerDot);

			// Richtungspfeil
			const arrowGroup = new THREE.Group();
			const arrowMat = new THREE.MeshBasicMaterial({
				color: 0xff6666,
				transparent: true,
				opacity: 0.6,
			});
			const shaft = new THREE.Mesh(
				new THREE.CylinderGeometry(0.08, 0.08, 2, 6),
				arrowMat,
			);
			shaft.position.y = 1;
			arrowGroup.add(shaft);
			const head = new THREE.Mesh(
				new THREE.ConeGeometry(0.3, 0.5, 6),
				arrowMat,
			);
			head.position.y = 2.3;
			arrowGroup.add(head);
			arrowGroup.position.copy(PLAYER_POS);
			arrowGroup.rotation.x = Math.PI / 2;
			scene.add(arrowGroup);

			// Städte bauen (blaue Zylinder)
			for (const city of CITIES) {
				const cityGroup = new THREE.Group();

				// Gebäude (Zylinder als Stadt-Symbol)
				const buildMat = new THREE.MeshBasicMaterial({
					color: 0x4488ff,
					transparent: true,
					opacity: 0.8,
				});
				for (let i = 0; i < 5; i++) {
					const h = 1 + Math.random() * 2.5;
					const w = 0.4 + Math.random() * 0.4;
					const b = new THREE.Mesh(
						new THREE.CylinderGeometry(w, w, h, 6),
						buildMat,
					);
					const angle = Math.random() * Math.PI * 2;
					const dist = 0.5 + Math.random() * 1.0;
					b.position.set(
						Math.cos(angle) * dist,
						h / 2 + getHeight(city.pos.x, city.pos.z),
						Math.sin(angle) * dist,
					);
					cityGroup.add(b);
				}

				// Leuchtender Ring um die Stadt
				const ringMat = new THREE.MeshBasicMaterial({
					color: 0x4488ff,
					transparent: true,
					opacity: 0.2,
					blending: THREE.AdditiveBlending,
					depthWrite: false,
					side: THREE.DoubleSide,
				});
				const ring = new THREE.Mesh(
					new THREE.RingGeometry(4, 5, 32),
					ringMat,
				);
				ring.rotation.x = -Math.PI / 2;
				ring.position.y = getHeight(city.pos.x, city.pos.z) + 0.05;
				cityGroup.add(ring);

				cityGroup.position.set(city.pos.x, 0, city.pos.z);
				cityGroup.userData.cityLabel = city.label;
				scene.add(cityGroup);

				// Stadt-Mesh für visited-Tracking
				for (const child of cityGroup.children) {
					if (child instanceof THREE.Mesh) {
						child.userData.cityLabel = city.label;
						cityMeshes.push(child);
					}
				}

				// Label (kleine Kugel mit der Stadtfarbe)
				const marker = new THREE.Mesh(
					new THREE.SphereGeometry(0.3, 8, 8),
					new THREE.MeshBasicMaterial({ color: 0x4488ff }),
				);
				marker.position.set(city.pos.x, 0.3, city.pos.z);
				scene.add(marker);
			}

			// Glow-Textur initialisieren (für Variante E)
			glowTexture = createGlowTexture();

			// Pfad-Gruppe zur Szene hinzufügen
			scene.add(pathGroup);

			// Ersten Pfad bauen
			buildPath();

			loading = false;

			// Animation
			const clock = new THREE.Clock();
			function animate() {
				const elapsed = clock.getElapsedTime();

				// Pfad-Animation: Pulsieren & Welle
				for (const child of pathGroup.children) {
					if (child instanceof THREE.Line) {
						const mat = child.material as THREE.LineBasicMaterial;
						mat.opacity = 0.65 + 0.35 * Math.sin(elapsed * 1.2);
					}
					if (child instanceof THREE.Mesh) {
						// Tube oder Ring
						if ((child.material as THREE.MeshBasicMaterial).blending === THREE.AdditiveBlending) {
							const mat = child.material as THREE.MeshBasicMaterial;
							mat.opacity = 0.6 + 0.35 * Math.sin(elapsed * 1.2);
						}
					}
					if (child instanceof THREE.Group) {
						// Variante C: mehrere Linien oder E: Sprites
						child.children.forEach((c) => {
							if (c instanceof THREE.Line) {
								const mat = c.material as THREE.LineBasicMaterial;
								mat.opacity = (0.5 + 0.3 * Math.sin(elapsed * 1.2 + Math.random())) as number;
							}
							if (c instanceof THREE.Sprite && c.material instanceof THREE.SpriteMaterial) {
								const phase = (c.userData.phase as number) ?? 0;
								c.material.opacity = 0.6 + 0.4 * Math.sin(elapsed * 1.8 + phase);
							}
						});
					}
				}

				// Player-Richtung sanft rotieren lassen (Demonstration)
				arrowGroup.rotation.y = Math.sin(elapsed * 0.15) * 1.5;

				// Prüfen ob Stadt erreicht wurde
				if (checkCityReached()) {
					buildPath();
				}

				controls.update();
				renderer.render(scene, camera);
				animationId = requestAnimationFrame(animate);
			}
			animationId = requestAnimationFrame(animate);
		} catch (e) {
			console.error("[CityGuidePath] FEHLER:", e);
			errorMsg = e instanceof Error ? e.message : String(e);
			loading = false;
		}
	});

	$effect(() => {
		// Bei Varianten-Wechsel Pfad neu bauen
		if (!loading && pathGroup) {
			buildPath();
		}
	});

	onDestroy(() => {
		if (!browser) return;
		cancelAnimationFrame(animationId);
		glowTexture?.dispose();
		renderer?.dispose();
		controls?.dispose();
	});
</script>

<div class="container">
	<canvas bind:this={canvas}></canvas>

	<div class="ui-overlay">
		<h1>🧪 City Guide Path – 5 Varianten (E = Glowy-Dashed)</h1>
		{#if loading}
			<p class="loading">Lade …</p>
		{/if}
		{#if errorMsg}
			<p class="error">{errorMsg}</p>
		{/if}
		<p class="hint">🔴 Player • 🔵 Städte • Pfad führt zur nächsten unbesuchten Stadt</p>
	</div>

	<div class="legend">
		<p class="legend-item"><span class="dot red"></span> Player (0,2,0)</p>
		<p class="legend-item"><span class="dot blue"></span> Stadt (unbesucht)</p>
		<p class="legend-item"><span class="dot green"></span> Stadt (besucht)</p>
	</div>

	<div class="controls">
		<p class="variant-label">
			Variante: <strong>{VARIANTS.find((v) => v.key === activeVariant)?.name ?? ""}</strong>
		</p>
		<p class="variant-desc">
			{VARIANTS.find((v) => v.key === activeVariant)?.desc ?? ""}
		</p>
		<div class="buttons">
			{#each VARIANTS as v}
				<button
					class="variant-btn"
					class:active={activeVariant === v.key}
					onclick={() => (activeVariant = v.key)}
				>
					{v.key} – {v.name}
				</button>
			{/each}
		</div>
		<p class="hint-bottom">
			🖱️ Ziehen zum Drehen • Scrollen zum Zoomen • Städte ~80–100m entfernt
		</p>
	</div>
</div>
<TestNav currentSlug="city-guide-path" />

<style>
	.container {
		position: fixed;
		inset: 0;
		overflow: hidden;
		max-width: none;
		padding: 0;
		font-family: system-ui, -apple-system, sans-serif;
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
		font-size: 1.15rem;
		font-weight: 600;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
		margin: 0 0 4px;
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
	.hint {
		color: rgba(255, 255, 255, 0.45);
		font-size: 0.7rem;
		margin: 4px 0 0;
	}

	.legend {
		position: absolute;
		bottom: 160px;
		right: 24px;
		z-index: 10;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(8px);
		border-radius: 8px;
		padding: 8px 14px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		pointer-events: none;
	}
	.legend-item {
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.7rem;
		margin: 2px 0;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}
	.dot.red {
		background: #ff4444;
	}
	.dot.blue {
		background: #4488ff;
	}
	.dot.green {
		background: #44cc44;
	}

	.controls {
		position: absolute;
		bottom: 30px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(10px);
		border-radius: 12px;
		padding: 14px 20px;
		text-align: center;
		z-index: 10;
		min-width: 520px;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}
	.variant-label {
		color: white;
		font-size: 0.9rem;
		margin: 0 0 2px;
	}
	.variant-label strong {
		color: #00ffff;
	}
	.variant-desc {
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.7rem;
		margin: 0 0 8px;
	}
	.buttons {
		display: flex;
		gap: 6px;
		justify-content: center;
		flex-wrap: wrap;
	}
	.variant-btn {
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		color: rgba(255, 255, 255, 0.8);
		padding: 6px 14px;
		border-radius: 6px;
		font-size: 0.78rem;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}
	.variant-btn:hover {
		background: rgba(255, 255, 255, 0.2);
	}
	.variant-btn.active {
		background: #00ffff;
		color: #0a0a1a;
		border-color: #00ffff;
		font-weight: 700;
		box-shadow: 0 0 16px rgba(0, 255, 255, 0.3);
	}

	.hint-bottom {
		color: rgba(255, 255, 255, 0.3);
		font-size: 0.65rem;
		margin: 8px 0 0;
	}
</style>
