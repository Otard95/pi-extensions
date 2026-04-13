import { execFile } from "node:child_process";

export function resolvePassSecret(entry: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("pass", ["show", entry], { timeout: 10_000 }, (err, stdout) => {
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
