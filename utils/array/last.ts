export function last<T>(arr: T[]): T {
	const v = arr[arr.length - 1];
	if (v === undefined) throw new Error(`Tried to take last of empty array`);
	return v;
}
