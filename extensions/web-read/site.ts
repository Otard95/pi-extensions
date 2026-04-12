import { homedir } from "node:os";
import { relative } from "node:path";
import { at } from "../../utils/array/at";
import { last } from "../../utils/array/last";
import { clone } from "../../utils/clone";

type Line = { n: number; text: string; match?: boolean };

export class Site {
	private readonly lines: Line[];
	private _limit = Infinity;
	private _offset?: number;
	private _context?: number;

	constructor(
		private readonly url: URL,
		private readonly path: string,
		private readonly title: string,
		content: string,
	) {
		this.lines = content.split("\n").map((t, i) => ({ n: i + 1, text: t }));
	}

	public filter(pattern?: RegExp): Site | SiteMatches {
		if (pattern) {
			return new SiteMatches(
				this.url,
				this.path,
				this.title,
				this._limit,
				this._offset !== undefined,
				pattern,
				this._context ?? 0,
				this.lines,
			);
		}
		return this;
	}

	public context(lines?: number): Site {
		if (lines) this._context = lines;
		return this;
	}

	public limit(lines?: number): Site {
		if (lines) this._limit = lines;
		return this;
	}

	public offset(lines?: number): Site {
		if (lines) this._offset = lines;
		return this;
	}

	public render(): string {
		const lines = this.lines
			.slice(this._offset, (this._offset ?? 0) + this._limit)
			.map((l) => `${l.n}: ${l.text}`)
			.join("\n");

		return [
			`Source: ${this.url.href}`,
			`Cached: ~/${relative(homedir(), this.path)}`,
			`Title: ${this.title}`,
			"",
			lines,
		].join("\n");
	}
}

export class SiteMatches {
	private lines: Line[];

	constructor(
		private readonly url: URL,
		private readonly path: string,
		private readonly title: string,
		private _limit: number,
		private warnOffset: boolean,
		private pattern: RegExp,
		private _context: number = 0,
		lines: Line[],
	) {
		this.lines = clone(lines);
	}

	public context(lines?: number): SiteMatches {
		if (lines) this._context = lines;
		return this;
	}

	public limit(lines: number): SiteMatches {
		this._limit = lines;
		return this;
	}

	public offset(lines?: number): SiteMatches {
		if (lines) this.warnOffset = true;
		return this;
	}

	private getMatches() {
		const clonedLines = clone(this.lines);
		const matchingIndices = clonedLines.reduce((indices, line, i) => {
			if (this.pattern.test(line.text)) {
				indices.push(i);
				line.match = true;
			}
			return indices;
		}, [] as number[]);

		const ranges: [number, number][] = [];
		if (matchingIndices.length) {
			let range: [number, number] = [
				Math.max(at(matchingIndices, 0) - this._context, 0),
				0,
			];
			for (let i = 0; i < matchingIndices.length - 1; i++) {
				const curr = at(matchingIndices, i);
				const next = at(matchingIndices, i + 1);
				if (next - curr > this._context * 2) {
					range[1] = curr + this._context;
					ranges.push(range);
					range = [next - this._context, 0];
				}
			}
			range[1] = Math.min(
				last(matchingIndices) + this._context,
				this.lines.length - 1,
			);
			ranges.push(range);
		}

		return ranges.map((r) => clonedLines.slice(r[0], r[1] + 1));
	}

	public render(): string {
		const out = [
			`Source: ${this.url.href}`,
			`Cached: ~/${relative(homedir(), this.path)}`,
			`Title: ${this.title}`,
			"",
		];

		if (this.warnOffset) {
			out.push("⚠️ 'offset' was ignored because 'pattern' was specified", "");
		}
		const matches = this.getMatches();
		out.push(`${matches.length} matches`, "");
		out.push(
			matches
				.slice(0, this._limit)
				.map((m) =>
					m.map((l) => `${l.match ? ">" : " "} ${l.n}: ${l.text}`).join("\n"),
				)
				.join("\n---\n"),
		);

		return out.join("\n");
	}
}
