/**
 * Test-Übersicht — Grid mit Icons für alle Testseiten.
 * Jede Karte zeigt Icon, Name und Beschreibung.
 */
<script lang="ts">
	import { Waves, Fish, Building } from "lucide-svelte";
	import type { ComponentType } from "svelte";

	const tests: { slug: string; name: string; description: string; icon: ComponentType }[] = [
		{
			slug: "experiment-12",
			name: "Tiefsee",
			description: "Endlose Unterwasserwelt mit Seegras, God Rays & Partikeln",
			icon: Waves,
		},
		{
			slug: "underwater-creatures",
			name: "Kreaturen",
			description: "Delfin, Hai und Fische im Größenvergleich",
			icon: Fish,
		},
		{
			slug: "city-colors",
			name: "Stadt-Farben",
			description: "Stadt mit 5 hellen Farbschemata zum Vergleichen",
			icon: Building,
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
		<p>Three.js-Experimente zum Durchklicken. Pfeiltasten oder Buttons zum Navigieren.</p>
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
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
