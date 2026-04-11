export function clone<T>(value: T): T {
	switch (typeof value) {
		case "object":
			if (value === null) return null as T;
			if (Array.isArray(value)) return value.map(clone) as T;
			return Object.fromEntries(
				Object.entries(value).map(([k, v]) => [k, clone(v)]),
			) as T;

		case "bigint":
			BigInt(value);
	}
	return value;
}
