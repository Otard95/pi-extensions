import { Result } from "../../utils/monad/result.js";
import type {
	ConfiguredSearchProvider,
	SearchAttempt,
	SearchContext,
	SearchProviderError,
	SearchProviderResult,
	SearchRequest,
} from "./types.js";
import { SearchRunError } from "./types.js";

export interface SearchRunResult {
	provider: ConfiguredSearchProvider;
	result: SearchProviderResult;
	attempts: SearchAttempt[];
}

export async function runSearch(
	providers: ConfiguredSearchProvider[],
	request: SearchRequest,
	context: SearchContext,
): Promise<Result<SearchRunResult, SearchRunError>> {
	const attempts: SearchAttempt[] = [];
	const deadline = Date.now() + context.timeoutMs;

	for (const configured of providers) {
		const { name, provider } = configured;
		const availability = await provider.checkAvailability();
		if (availability.isErr()) {
			attempts.push({
				provider: name,
				status: "skipped",
				reason: availability.unwrapErr().message,
			});
			continue;
		}

		const startedAt = Date.now();
		const search = await provider.search(request, {
			signal: context.signal,
			timeoutMs: Math.max(0, deadline - startedAt),
		});

		if (search.isOk()) {
			attempts.push({
				provider: name,
				status: "success",
				durationMs: Date.now() - startedAt,
			});
			return Result.Ok({
				provider: configured,
				result: search.unwrap(),
				attempts,
			});
		}

		const error = search.unwrapErr();
		attempts.push({
			provider: name,
			status: "failed",
			durationMs: Date.now() - startedAt,
			reason: error.message,
		});

		if (!isFallbackEligible(error) || Date.now() >= deadline) {
			return Result.Err(new SearchRunError(attempts));
		}
	}

	return Result.Err(new SearchRunError(attempts));
}

function isFallbackEligible(error: SearchProviderError): boolean {
	return error.kind !== "configuration";
}
