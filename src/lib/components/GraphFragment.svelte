<script lang="ts">
	/**
	 * The part of the knowledge graph an agent walk visited (`explore_graph`,
	 * $lib/graph-walk): the start in the middle, what it connects to around
	 * it, the next step further out next to the node it came through.
	 */
	import { goto } from '$app/navigation';
	import type { GraphEdge, GraphNode, GraphNodeKind } from '$lib/graph-walk';

	let { nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] } = $props();

	const W = 340;
	const H = 240;
	const CX = W / 2;
	const CY = H / 2;
	const RINGS = [0, 70, 108];

	const COLORS: Record<GraphNodeKind, string> = {
		note: 'var(--color-accent)',
		person: '#40a02b',
		project: '#df8e1d',
		tag: '#179299',
		todo: '#1e66f5',
		decision: '#8839ef',
		question: '#d20f39'
	};

	let layout = $derived.by(() => {
		const pos = new Map<string, { x: number; y: number; angle: number }>();
		const byDepth = (d: number) => nodes.filter((n) => n.depth === d);
		const start = byDepth(0)[0];
		if (!start) return pos;
		pos.set(start.id, { x: CX, y: CY, angle: 0 });
		const first = byDepth(1);
		first.forEach((n, i) => {
			const angle = (i / Math.max(first.length, 1)) * Math.PI * 2 - Math.PI / 2;
			pos.set(n.id, { x: CX + Math.cos(angle) * RINGS[1] * 1.35, y: CY + Math.sin(angle) * RINGS[1], angle });
		});
		// Further out: near the node they were reached through.
		for (const d of [2, 3]) {
			const level = byDepth(d);
			const groups = new Map<string, GraphNode[]>();
			for (const n of level) {
				const via = edges.find((e) => e.to === n.id && pos.has(e.from))?.from ?? edges.find((e) => e.from === n.id && pos.has(e.to))?.to;
				const list = groups.get(via ?? start.id) ?? [];
				list.push(n);
				groups.set(via ?? start.id, list);
			}
			for (const [via, list] of groups) {
				const base = pos.get(via)?.angle ?? 0;
				list.forEach((n, i) => {
					const angle = base + (i - (list.length - 1) / 2) * 0.32;
					const r = RINGS[2] + (d - 2) * 18;
					pos.set(n.id, { x: CX + Math.cos(angle) * r * 1.42, y: CY + Math.sin(angle) * r, angle });
				});
			}
		}
		return pos;
	});

	const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
</script>

<figure class="graph-fragment" aria-label="Notes and links the assistant followed">
	<svg viewBox="0 0 {W} {H}" role="img">
		{#each edges as e (e.from + e.to)}
			{@const a = layout.get(e.from)}
			{@const b = layout.get(e.to)}
			{#if a && b}
				<line x1={a.x} y1={a.y} x2={b.x} y2={b.y}><title>{e.label}</title></line>
			{/if}
		{/each}
		{#each nodes as n (n.id)}
			{@const p = layout.get(n.id)}
			{#if p}
				<g
					class="node"
					class:start={n.depth === 0}
					transform="translate({p.x} {p.y})"
					role="link"
					tabindex="0"
					onclick={() => n.href && goto(n.href)}
					onkeydown={(e) => e.key === 'Enter' && n.href && goto(n.href)}
				>
					<title>{n.label}: {n.snippet}</title>
					<circle r={n.depth === 0 ? 7 : n.depth === 1 ? 5 : 3.5} fill={COLORS[n.kind]} />
					{#if n.depth < 2 || nodes.length <= 14}
						<!-- Near the sides, labels grow inwards so they aren't cut off -->
						<text y={n.depth === 0 ? -11 : -8} text-anchor={p.x < 80 ? 'start' : p.x > W - 80 ? 'end' : 'middle'} x={p.x < 80 ? -4 : p.x > W - 80 ? 4 : 0}>{short(n.label, n.depth === 0 ? 28 : 18)}</text>
					{/if}
				</g>
			{/if}
		{/each}
	</svg>
	<figcaption>
		{#each Object.entries(COLORS).filter(([k]) => nodes.some((n) => n.kind === k)) as [kind, color] (kind)}
			<span><i style="background: {color}"></i>{kind === 'todo' ? 'to-do' : kind}</span>
		{/each}
	</figcaption>
</figure>

<style>
	.graph-fragment {
		margin: 0.5rem 0 0;
		padding: 0.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
	}

	line {
		stroke: var(--color-border);
		stroke-width: 1;
	}

	.node {
		cursor: pointer;
		outline: none;
	}

	.node text {
		font-size: 8px;
		fill: var(--color-text-muted);
		paint-order: stroke;
		stroke: var(--color-bg-secondary);
		stroke-width: 3px;
	}

	.node.start text {
		font-size: 9.5px;
		font-weight: 600;
		fill: var(--color-text);
	}

	.node:hover text,
	.node:focus-visible text {
		fill: var(--color-accent);
	}

	.node:focus-visible circle {
		stroke: var(--color-text);
		stroke-width: 1.5;
	}

	figcaption {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		padding: 0 0.375rem 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-text-faint);
	}

	figcaption i {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: 0.25rem;
		border-radius: 999px;
	}
</style>
