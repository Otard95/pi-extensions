import { resolvePassSecret } from "./pass";

export async function resolveValue<T>(value: T): Promise<T> {
	switch (typeof value) {
		case "string":
			return (await resolveSecretInString(value)) as T;
		case "object":
			if (value === null) return value;
			if (Array.isArray(value))
				return (await Promise.all(value.map(resolveValue))) as T;
			return Object.fromEntries(
				await Promise.all(
					Object.entries(value).map(async ([k, v]) => [
						k,
						await resolveValue(v),
					]),
				),
			) as T;
	}
	return value;
}

function resolveSecretInString(s: string): Promise<string> {
	if (s.startsWith("pass:")) return resolvePassSecret(s.slice(5));
	return Promise.resolve(s);
}
