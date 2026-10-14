export function at<T>(arr: ArrayLike<T>, i: number): T {
	const v = arr[i];
	if (v === undefined) throw new Error(`out of bounds: ${i}`);
	return v;
}
