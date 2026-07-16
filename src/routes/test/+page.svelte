/**
 * Test-Übersicht — Grid mit Icons für alle 18 Testseiten.
 * Jede Karte zeigt Icon, Name und Beschreibung.
 */
<script lang="ts">
	import {
		Trees,
		CloudSun,
		Sparkles,
		Cloud,
		Flower2,
		Bug,
		Heart,
		Building,
		Radar,
		Eye,
		GitCompareArrows,
		Globe,
		Play,
		MapPin,
		Route,
	} from "lucide-svelte";
	import type { ComponentType } from "svelte";

	const tests: { slug: string; name: string; description: string; icon: ComponentType }[] = [
		{
			slug: "wiese",
			name: "Wiese",
			description: "5000 Grashalme mit Wind-Shader",
			icon: Trees,
		},
		{
			slug: "wiese-himmel",
			name: "Wiese & Himmel",
			description: "Frühlingswiese + 6 Himmelsvarianten",
			icon: CloudSun,
		},
		{
			slug: "wiese-komplett",
			name: "Wiese Komplett",
			description: "Wiese + Himmel + Stadt + Bienen + Schmetterlinge",
			icon: Sparkles,
		},
		{
			slug: "blauer-himmel",
			name: "Blauer Himmel",
			description: "4 Wetter-Varianten mit prozeduralen Wolken",
			icon: Cloud,
		},
		{
			slug: "blumen",
			name: "Blumen",
			description: "3 Lowpoly-Blumenarten in der Wiese",
			icon: Flower2,
		},
		{
			slug: "bienen",
			name: "Bienen",
			description: "Bienenschwarm auf Orbital-Pfad",
			icon: Bug,
		},
		{
			slug: "schmetterlinge",
			name: "Schmetterlinge",
			description: "Schmetterlinge zwischen Blüten",
			icon: Heart,
		},
		{
			slug: "stadt",
			name: "Stadt",
			description: "Ameisen-Perspektive auf die Stadt",
			icon: Building,
		},
		{
			slug: "pheromon-abstand",
			name: "Pheromon Abstand",
			description: "Pheromon-Spuren im 20–35m Abstand",
			icon: Radar,
		},
		{
			slug: "facettenauge",
			name: "Facettenauge",
			description: "Insekten-Augen-Effekt auf die Szene",
			icon: Eye,
		},
		{
			slug: "insekten-vergleich",
			name: "Insekten Vergleich",
			description: "Bienen vs. Schmetterlinge Seite an Seite",
			icon: GitCompareArrows,
		},
		{
			slug: "insekten-welt-v2",
			name: "Insekten Welt V2",
			description: "WebGPU Szene mit Wiese, Blumen & Bienen",
			icon: Globe,
		},
		{
			slug: "erlebnis",
			name: "Erlebnis",
			description: "Komplette Insekten-Welt mit WASD-Steuerung",
			icon: Play,
		},
		{
			slug: "city-guide-path",
			name: "City Guide Path",
			description: "4 Neon-Pfad-Varianten zur Stadt",
			icon: MapPin,
		},
		{
			slug: "guidepath-ab",
			name: "Guidepath AB",
			description: "A/B-Vergleich der Leuchtspur-Parameter",
			icon: Route,
		},
	];
</script>

<svelte:head>
	<title>Tests — ICAROS VR</title>
</svelte:head>

<main>
	<header class="header">
		<a href="/" class="back-link">← Hauptseite</a>
		<h1>Test Pages</h1>
		<p>18 Three.js-Experimente zum Durchklicken. Pfeiltasten oder Buttons zum Navigieren.</p>
	</header>

	<div class="grid">
		{#each tests as test, i}
			<a href="/test/{test.slug}" class="card">
				<span class="card-number">{i + 1}</span>
				<div class="card-icon">
					<test.icon size={28} />
				</div>
				<h2 class="card-title">{test.name}</h2>
				<p class="card-desc">{test.description}</p>
			</a>
		{/each}
	</div>
</main>

<style>
	main {
		max-width: 900px;
		margin: 0 auto;
		padding: 3rem 1.5rem;
		font-family: "JetBrains Mono", monospace;
	}

	.header {
		margin-bottom: 2.5rem;
	}

	.back-link {
		color: #7c6ef0;
		text-decoration: none;
		font-size: 0.8rem;
		display: inline-block;
		margin-bottom: 1rem;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	h1 {
		font-size: 1.6rem;
		color: #fafafa;
		margin: 0 0 0.5rem;
	}

	p {
		color: #71717a;
		font-size: 0.85rem;
		margin: 0;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 1.5rem 1rem;
		background: #18181b;
		border: 1px solid #27272a;
		border-radius: 10px;
		text-decoration: none;
		transition: background 0.2s, border-color 0.2s, transform 0.15s;
		position: relative;
	}

	.card:hover {
		background: #27272a;
		border-color: #7c6ef0;
		transform: translateY(-2px);
	}

	.card-number {
		position: absolute;
		top: 8px;
		right: 10px;
		font-size: 0.6rem;
		color: #52525b;
	}

	.card-icon {
		color: #7c6ef0;
		margin-bottom: 0.75rem;
	}

	.card-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #fafafa;
		margin: 0 0 0.4rem;
	}

	.card-desc {
		font-size: 0.7rem;
		color: #71717a;
		margin: 0;
		line-height: 1.4;
	}
</style>
