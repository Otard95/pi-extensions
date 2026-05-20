/**
 * Wraps a function so it only executes once. Subsequent calls return
 * the same result (including the same Promise for async functions).
 */
export function once<A extends unknown[], R>(
	fn: (...args: A) => R,
): (...args: A) => R | undefined {
	let hasRun = false;
	let result: R | undefined;
	return (...args: A) => {
		if (hasRun) return result;
		hasRun = true;
		result = fn(...args);
		return result;
	};
}
