// ---------------------------------------------------------------------------
// Inference router (roadmap §8.2) — stub.
//
// Picks an execution target + provider for a given task based on policy and
// context. This is the contract; real adapters and richer policy logic land
// in Phase 6/7. For now a single registered provider is returned for every
// task so callers can be wired against the router today.
// ---------------------------------------------------------------------------

import type {
	InferenceProvider,
	InferenceRouter,
	InferenceTask,
	RoutingContext,
	RoutingDecision,
	ExecutionTarget
} from './types';

export class SimpleInferenceRouter implements InferenceRouter {
	private providers = new Map<string, InferenceProvider>();

	register(provider: InferenceProvider): void {
		this.providers.set(provider.capabilities.id, provider);
	}

	route(task: InferenceTask, ctx: RoutingContext): RoutingDecision {
		const candidates = [...this.providers.values()];
		if (candidates.length === 0) {
			throw new Error(`No inference providers registered for task "${task}"`);
		}

		const target = pickTarget(ctx);
		const preferred =
			candidates.find((p) => p.capabilities.target === target) ?? candidates[0];

		return {
			target: preferred.capabilities.target,
			providerId: preferred.capabilities.id,
			model: preferred.capabilities.models[0] ?? 'default',
			reason: explain(ctx, preferred.capabilities.target === target)
		};
	}

	getProvider(decision: RoutingDecision): InferenceProvider {
		const provider = this.providers.get(decision.providerId);
		if (!provider) {
			throw new Error(`Unknown inference provider "${decision.providerId}"`);
		}
		return provider;
	}

	/**
	 * Find the first registered provider that satisfies a capability predicate.
	 * Used by call sites that need a specific feature (e.g. transcription)
	 * before the full task→provider routing matrix is in place.
	 */
	findProvider(
		predicate: (capabilities: InferenceProvider['capabilities']) => boolean
	): InferenceProvider | null {
		for (const provider of this.providers.values()) {
			if (predicate(provider.capabilities)) return provider;
		}
		return null;
	}
}

function pickTarget(ctx: RoutingContext): ExecutionTarget {
	if (ctx.preferTarget) return ctx.preferTarget;
	if (!ctx.online) return 'local';
	switch (ctx.policy) {
		case 'offline-only':
		case 'private-first':
			return 'local';
		case 'best-quality':
			return 'remote';
		case 'work-safe':
			return ctx.sensitivity === 'confidential' ? 'local' : 'remote';
		case 'auto':
		default:
			return ctx.sensitivity === 'confidential' ? 'local' : 'remote';
	}
}

function explain(ctx: RoutingContext, matched: boolean): string {
	if (!ctx.online) return 'offline → local';
	if (!matched) return `policy=${ctx.policy}, fallback to only registered provider`;
	return `policy=${ctx.policy}`;
}

export const inferenceRouter = new SimpleInferenceRouter();
