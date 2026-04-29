import { execFile } from "node:child_process";
import { loadSettings } from "../settings";

const DEFAULT_TIMEOUT = 10_000;

function getTimeout(): number {
	return loadSettings<{ timeout: number }>("pass")
		.map((s) => s.timeout)
		.unwrapOr(DEFAULT_TIMEOUT);
}

export function resolvePassSecret(entry: string): Promise<string> {
	const timeout = getTimeout();
	return new Promise((resolve, reject) => {
		execFile("pass", ["show", entry], { timeout }, (err, stdout) => {
			if (err) {
				reject(
					new Error(`Failed to resolve pass entry "${entry}": ${err.message}`),
				);
				return;
			}
			// pass output may have trailing newline, first line is the secret
			const firstLine = stdout.split("\n")[0]?.trim();
			if (!firstLine) {
				reject(new Error(`pass entry "${entry}" is empty`));
				return;
			}
			resolve(firstLine);
		});
	});
}
