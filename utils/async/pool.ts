/**
 * Run tasks with bounded concurrency, returning settled results in input order.
 * Prevents rate-limit thrashing when dispatching many API calls at once.
 */
export async function settledPool<T>(
	tasks: (() => Promise<T>)[],
	concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
	const results: PromiseSettledResult<T>[] = new Array(tasks.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < tasks.length) {
			const i = nextIndex++;
			try {
				results[i] = { status: "fulfilled", value: await tasks[i]!() };
			} catch (reason) {
				results[i] = { status: "rejected", reason };
			}
		}
	}

	const workers = Array.from(
		{ length: Math.min(concurrency, tasks.length) },
		() => worker(),
	);
	await Promise.all(workers);

	return results;
}
