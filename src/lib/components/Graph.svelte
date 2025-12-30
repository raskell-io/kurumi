<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { notes, extractWikilinks } from '$lib/db';
	import { goto } from '$app/navigation';
	import ForceGraph from 'force-graph';

	interface Props {
		highlightNoteId?: string;
	}

	let { highlightNoteId }: Props = $props();

	let containerRef: HTMLDivElement;
	let graph: ReturnType<typeof ForceGraph> | null = null;

	interface GraphNode {
		id: string;
		name: string;
		val: number;
		color?: string;
	}

	interface GraphLink {
		source: string;
		target: string;
	}

	function buildGraphData(): { nodes: GraphNode[]; links: GraphLink[] } {
		const allNotes = $notes;
		const noteMap = new Map(allNotes.map((n) => [n.title.toLowerCase(), n.id]));

		const nodes: GraphNode[] = allNotes.map((note) => {
			const linkCount = extractWikilinks(note.content).length;
			return {
				id: note.id,
				name: note.title || 'Untitled',
				val: Math.max(1, linkCount + 1),
				color: note.id === highlightNoteId ? '#818cf8' : undefined
			};
		});

		const links: GraphLink[] = [];
		for (const note of allNotes) {
			const wikilinks = extractWikilinks(note.content);
			for (const link of wikilinks) {
				const targetId = noteMap.get(link.toLowerCase());
				if (targetId && targetId !== note.id) {
					links.push({ source: note.id, target: targetId });
				}
			}
		}

		return { nodes, links };
	}

	function initGraph() {
		if (!containerRef || graph) return;

		const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const { nodes, links } = buildGraphData();

		graph = ForceGraph()(containerRef)
			.graphData({ nodes, links })
			.nodeLabel('name')
			.nodeColor((node: GraphNode) => node.color || (isDark ? '#9ca3af' : '#6b7280'))
			.nodeVal((node: GraphNode) => node.val)
			.linkColor(() => (isDark ? '#374151' : '#e5e7eb'))
			.linkWidth(1)
			.linkDirectionalParticles(1)
			.linkDirectionalParticleWidth(2)
			.backgroundColor('transparent')
			.onNodeClick((node: GraphNode) => {
				goto(`/note/${node.id}`);
			})
			.onNodeHover((node: GraphNode | null) => {
				containerRef.style.cursor = node ? 'pointer' : 'default';
			})
			.cooldownTicks(100)
			.onEngineStop(() => {
				graph?.zoomToFit(400, 50);
			});

		// Handle resize
		const resizeObserver = new ResizeObserver(() => {
			if (graph && containerRef) {
				graph.width(containerRef.clientWidth);
				graph.height(containerRef.clientHeight);
			}
		});
		resizeObserver.observe(containerRef);

		return () => resizeObserver.disconnect();
	}

	$effect(() => {
		// Re-render when notes change
		if (graph && $notes) {
			const { nodes, links } = buildGraphData();
			graph.graphData({ nodes, links });
		}
	});

	onMount(() => {
		const cleanup = initGraph();
		return cleanup;
	});

	onDestroy(() => {
		if (graph) {
			graph._destructor?.();
			graph = null;
		}
	});
</script>

<div bind:this={containerRef} class="h-full w-full"></div>
