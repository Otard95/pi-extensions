export interface RateLimitRule {
	count: number;
	window: {
		s?: number;
		m?: number;
	};
	message?: string;
}

export interface RateLimitResult {
	allowed: boolean;
	reason?: string;
}

export class ProviderRateLimiter {
	private readonly requests = new Map<string, number[]>();

	constructor(private readonly limits: Record<string, RateLimitRule[]>) {}

	acquire(provider: string, now = Date.now()): RateLimitResult {
		const rules = this.limits[provider];
		if (!rules?.length) return { allowed: true };

		const requests = this.requests.get(provider) ?? [];
		const active = requests.filter((request) =>
			rules.some((rule) => request > now - windowMs(rule.window)),
		);
		this.requests.set(provider, active);

		const limit = rules.find(
			(rule) =>
				active.filter((request) => request > now - windowMs(rule.window))
					.length >= rule.count,
		);
		if (limit) {
			return {
				allowed: false,
				reason:
					limit.message ??
					`Local rate limit reached for ${provider}: ${limit.count} request${limit.count === 1 ? "" : "s"} per ${formatWindow(limit.window)}.`,
			};
		}

		active.push(now);
		this.requests.set(provider, active);
		return { allowed: true };
	}
}

function windowMs(window: RateLimitRule["window"]): number {
	return ((window.s ?? 0) + (window.m ?? 0) * 60) * 1_000;
}

function formatWindow(window: RateLimitRule["window"]): string {
	const parts = [
		window.m ? `${window.m} minute${window.m === 1 ? "" : "s"}` : undefined,
		window.s ? `${window.s} second${window.s === 1 ? "" : "s"}` : undefined,
	].filter((part): part is string => part !== undefined);
	return parts.join(" and ");
}
