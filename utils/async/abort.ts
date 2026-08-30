export interface AbortSignalWithTimeout {
	signal: AbortSignal;
	dispose: () => void;
}

export function abortSignalWithTimeout(
	signal: AbortSignal | undefined,
	timeoutMs: number,
): AbortSignalWithTimeout {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const abort = () => controller.abort();
	if (signal?.aborted) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		},
	};
}
