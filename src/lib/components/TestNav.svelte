/**
 * TestNav — Navigations-Leiste für Testseiten.
 * Zeigt 3 Buttons: Zurück zur Übersicht, Vorherige Testseite, Nächste Testseite.
 * Blendet sich bei Inaktivität ein/aus.
 */
<script lang="ts">
	interface Props {
		currentSlug: string;
	}

	const { currentSlug }: Props = $props();

	const testPages = [
		{ slug: "experiment-12", name: "Tiefsee" },
		{ slug: "underwater-creatures", name: "Kreaturen" },
		{ slug: "city-colors", name: "Stadt-Farben" },
	];

	const currentIndex = $derived(testPages.findIndex((p) => p.slug === currentSlug));
	const prevPage = $derived(currentIndex > 0 ? testPages[currentIndex - 1] : null);
	const nextPage = $derived(currentIndex < testPages.length - 1 ? testPages[currentIndex + 1] : null);

	let visible = $state(false);
	let timeout: ReturnType<typeof setTimeout>;

	function showNav() {
		visible = true;
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			visible = false;
		}, 3000);
	}

	function handleMouseMove() {
		showNav();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "ArrowLeft" && prevPage) {
			window.location.href = `/test/${prevPage.slug}`;
		}
		if (e.key === "ArrowRight" && nextPage) {
			window.location.href = `/test/${nextPage.slug}`;
		}
		if (e.key === "Escape") {
			window.location.href = "/test";
		}
	}

	$effect(() => {
		showNav();
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("keydown", handleKeyDown);
			clearTimeout(timeout);
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="test-nav" class:visible onmousemove={showNav}>
	<a href="/test" class="nav-btn nav-btn--home">
		<span class="nav-icon">✕</span>
		<span class="nav-label">Übersicht</span>
	</a>

	<div class="nav-center">
		<span class="nav-position">{currentIndex + 1} / {testPages.length}</span>
		<span class="nav-name">{testPages[currentIndex]?.name}</span>
	</div>

	<div class="nav-arrows">
		{#if prevPage}
			<a href="/test/{prevPage.slug}" class="nav-btn nav-btn--arrow">
				<span class="nav-icon">←</span>
				<span class="nav-label">{prevPage.name}</span>
			</a>
		{:else}
			<span class="nav-btn nav-btn--arrow nav-btn--disabled">
				<span class="nav-icon">←</span>
				<span class="nav-label">Start</span>
			</span>
		{/if}

		{#if nextPage}
			<a href="/test/{nextPage.slug}" class="nav-btn nav-btn--arrow">
				<span class="nav-label">{nextPage.name}</span>
				<span class="nav-icon">→</span>
			</a>
		{:else}
			<span class="nav-btn nav-btn--arrow nav-btn--disabled">
				<span class="nav-label">Ende</span>
				<span class="nav-icon">→</span>
			</span>
		{/if}
	</div>
</div>

<style>
	.test-nav {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 20px;
		background: rgba(0, 0, 0, 0.75);
		backdrop-filter: blur(12px);
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		font-family: "JetBrains Mono", monospace;
		font-size: 0.75rem;
		opacity: 0;
		transform: translateY(100%);
		transition: opacity 0.3s, transform 0.3s;
		pointer-events: none;
		z-index: 1000;
	}

	.test-nav.visible {
		opacity: 1;
		transform: translateY(0);
		pointer-events: auto;
	}

	.nav-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: rgba(255, 255, 255, 0.8);
		text-decoration: none;
		transition: background 0.2s, color 0.2s;
		white-space: nowrap;
	}

	.nav-btn:hover {
		background: rgba(255, 255, 255, 0.18);
		color: white;
	}

	.nav-btn--disabled {
		opacity: 0.3;
		pointer-events: none;
	}

	.nav-btn--home {
		background: rgba(124, 110, 240, 0.2);
		border-color: rgba(124, 110, 240, 0.3);
	}

	.nav-btn--home:hover {
		background: rgba(124, 110, 240, 0.4);
	}

	.nav-icon {
		font-size: 0.9rem;
	}

	.nav-center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.nav-position {
		color: rgba(255, 255, 255, 0.4);
		font-size: 0.65rem;
	}

	.nav-name {
		color: rgba(255, 255, 255, 0.9);
		font-weight: 600;
		font-size: 0.8rem;
	}

	.nav-arrows {
		display: flex;
		gap: 8px;
	}

	.nav-label {
		font-size: 0.7rem;
	}
</style>
