import type {
	ContextUsage,
	SessionEntry,
	SessionHeader,
	Theme,
} from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

interface InspectorOptions {
	systemPrompt: string;
	entries: SessionEntry[];
	branch: SessionEntry[];
	header: SessionHeader;
	leafId: string | null;
	sessionFile: string | undefined;
	sessionName: string | undefined;
	usage: ContextUsage | undefined;
	theme: Theme;
	tui: TUI;
	onClose: () => void;
}

type DisplayMode = "pretty" | "json";

/** A collapsible section in the inspector */
interface Section {
	title: string;
	badge?: string;
	expanded: boolean;
	/** Pretty-printed content */
	renderLines: (width: number) => string[];
	/** Raw data for JSON mode */
	rawData: unknown;
}

// Content block shapes from messages
interface TextBlock {
	type: "text";
	text: string;
}
interface ThinkingBlock {
	type: "thinking";
	thinking: string;
}
interface ToolCallBlock {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}
type ContentBlock =
	| TextBlock
	| ThinkingBlock
	| ToolCallBlock
	| { type: string };

export class ContextInspector implements Component {
	private sections: Section[] = [];
	private selectedIndex = 0;
	private scrollOffset = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private theme: Theme;
	private tui: TUI;
	private onClose: () => void;
	private mode: DisplayMode = "pretty";

	constructor(opts: InspectorOptions) {
		this.theme = opts.theme;
		this.tui = opts.tui;
		this.onClose = opts.onClose;
		this.buildSections(opts);
	}

	/** Terminal viewport height */
	private get viewportHeight(): number {
		return Math.floor(this.tui.terminal.rows * 0.8);
	}

	private buildSections(opts: InspectorOptions) {
		// 1. Session Info (starts expanded)
		this.sections.push({
			title: "Session Info",
			expanded: true,
			rawData: {
				header: opts.header,
				sessionFile: opts.sessionFile,
				sessionName: opts.sessionName,
				leafId: opts.leafId,
				entryCount: opts.entries.length,
				branchCount: opts.branch.length,
				usage: opts.usage,
			},
			renderLines: (w) => {
				const iw = w - 4;
				const lines: string[] = [];
				lines.push(this.kv("Session ID", opts.header.id, iw));
				lines.push(this.kv("Version", String(opts.header.version), iw));
				lines.push(this.kv("CWD", opts.header.cwd, iw));
				lines.push(this.kv("File", opts.sessionFile ?? "(ephemeral)", iw));
				if (opts.sessionName) lines.push(this.kv("Name", opts.sessionName, iw));
				lines.push(this.kv("Leaf ID", opts.leafId ?? "(none)", iw));
				lines.push(this.kv("Entries (total)", String(opts.entries.length), iw));
				lines.push(this.kv("Branch entries", String(opts.branch.length), iw));
				if (opts.header.parentSession)
					lines.push(this.kv("Parent Session", opts.header.parentSession, iw));
				if (opts.usage && opts.usage.tokens !== null) {
					const pct =
						opts.usage.percent !== null
							? ` (${Math.round(opts.usage.percent)}%)`
							: "";
					lines.push(
						this.kv(
							"Context tokens",
							`${opts.usage.tokens.toLocaleString()}${pct}`,
							iw,
						),
					);
				}
				return lines;
			},
		});

		// 2. System Prompt (starts collapsed)
		this.sections.push({
			title: "System Prompt",
			badge: `${opts.systemPrompt.length.toLocaleString()} chars`,
			expanded: false,
			rawData: opts.systemPrompt,
			renderLines: (w) => this.wrap(opts.systemPrompt, w - 4),
		});

		// 3. Branch entries
		for (let i = 0; i < opts.branch.length; i++) {
			const entry = opts.branch[i];
			if (!entry) continue;
			const section = this.entrySection(entry, i);
			if (section) this.sections.push(section);
		}
	}

	private entrySection(entry: SessionEntry, index: number): Section | null {
		const t = this.theme;
		const raw = entry;

		if (entry.type === "message") {
			const msg = entry.message;
			const role: string = msg.role;

			if (role === "user") {
				const text = this.textOf((msg as { content: unknown }).content);
				return {
					title: `#${index} User Message`,
					badge: entry.id,
					expanded: false,
					rawData: raw,
					renderLines: (w) => {
						const iw = w - 4;
						const lines = this.wrap(text || "(empty)", iw);
						lines.push(this.kv("Timestamp", entry.timestamp, iw));
						return lines;
					},
				};
			}

			if (role === "assistant") {
				const content = (msg as { content: unknown[] })
					.content as ContentBlock[];
				const texts = this.textPartsOf(content);
				const thinking = this.thinkingOf(content);
				const tools = this.toolCallsOf(content);
				const aMsg = msg as {
					provider?: string;
					model?: string;
					stopReason?: string;
					usage?: {
						input: number;
						output: number;
						cacheRead: number;
						cacheWrite: number;
						totalTokens: number;
						cost?: { total: number };
					};
				};
				const model = aMsg.model ? `${aMsg.provider}/${aMsg.model}` : undefined;

				return {
					title: `#${index} Assistant`,
					badge: model ?? entry.id,
					expanded: false,
					rawData: raw,
					renderLines: (w) => {
						const iw = w - 4;
						const lines: string[] = [];
						if (model) lines.push(this.kv("Model", model, iw));
						if (aMsg.stopReason)
							lines.push(this.kv("Stop", aMsg.stopReason, iw));
						if (aMsg.usage) {
							lines.push(
								this.kv(
									"Tokens",
									`in:${aMsg.usage.input} out:${aMsg.usage.output} cache_r:${aMsg.usage.cacheRead} cache_w:${aMsg.usage.cacheWrite} total:${aMsg.usage.totalTokens}`,
									iw,
								),
							);
							if (aMsg.usage.cost)
								lines.push(
									this.kv("Cost", `$${aMsg.usage.cost.total.toFixed(6)}`, iw),
								);
						}
						if (thinking.length > 0) {
							lines.push("", t.fg("muted", t.bold("── Thinking ──")));
							for (const tp of thinking) lines.push(...this.wrap(tp, iw));
						}
						if (texts.length > 0) {
							lines.push("", t.fg("muted", t.bold("── Response ──")));
							for (const tp of texts) lines.push(...this.wrap(tp, iw));
						}
						if (tools.length > 0) {
							lines.push("", t.fg("muted", t.bold("── Tool Calls ──")));
							for (const tc of tools) {
								lines.push(
									`${t.fg("accent", tc.name)} ${t.fg("dim", `(${tc.id})`)}`,
								);
								lines.push(
									...this.wrap(JSON.stringify(tc.arguments, null, 2), iw).map(
										(l) => `  ${l}`,
									),
								);
							}
						}
						lines.push(this.kv("Timestamp", entry.timestamp, iw));
						return lines;
					},
				};
			}

			if (role === "toolResult") {
				const trMsg = msg as {
					toolName?: string;
					toolCallId?: string;
					isError?: boolean;
					content: unknown;
					details?: unknown;
				};
				const text = this.textOf(trMsg.content);
				const isErr = !!trMsg.isError;
				const errPreview =
					isErr && text ? `: ${text.split("\n")[0]?.slice(0, 80)}` : "";
				return {
					title: `#${index} Tool Result: ${trMsg.toolName ?? "?"}${errPreview}`,
					badge: isErr ? "ERROR" : entry.id,
					expanded: false,
					rawData: raw,
					renderLines: (w) => {
						const iw = w - 4;
						const lines: string[] = [];
						lines.push(this.kv("Tool", trMsg.toolName ?? "?", iw));
						lines.push(this.kv("Call ID", trMsg.toolCallId ?? "?", iw));
						if (isErr) lines.push(t.fg("error", "! Error result"));
						if (text) {
							lines.push("", t.fg("muted", t.bold("── Output ──")));
							this.pushCapped(lines, this.wrap(text, iw), 100);
						}
						if (trMsg.details !== undefined) {
							lines.push("", t.fg("muted", t.bold("── Details ──")));
							this.pushCapped(
								lines,
								this.wrap(JSON.stringify(trMsg.details, null, 2), iw),
								50,
							);
						}
						lines.push(this.kv("Timestamp", entry.timestamp, iw));
						return lines;
					},
				};
			}

			if (role === "bashExecution") {
				const bMsg = msg as {
					command?: string;
					output?: string;
					exitCode?: number;
				};
				return {
					title: `#${index} Bash Execution`,
					badge: entry.id,
					expanded: false,
					rawData: raw,
					renderLines: (w) => {
						const iw = w - 4;
						const lines: string[] = [];
						lines.push(this.kv("Command", bMsg.command ?? "", iw));
						lines.push(this.kv("Exit Code", String(bMsg.exitCode ?? "?"), iw));
						if (bMsg.output) {
							lines.push("");
							this.pushCapped(lines, this.wrap(bMsg.output, iw), 50);
						}
						return lines;
					},
				};
			}

			if (role === "custom") {
				const cMsg = msg as {
					customType?: string;
					content: unknown;
					details?: unknown;
				};
				return {
					title: `#${index} Custom: ${cMsg.customType ?? "?"}`,
					badge: entry.id,
					expanded: false,
					rawData: raw,
					renderLines: (w) => {
						const iw = w - 4;
						const lines: string[] = [];
						lines.push(this.kv("Type", cMsg.customType ?? "?", iw));
						const text = this.textOf(cMsg.content);
						if (text) lines.push(...this.wrap(text, iw));
						if (cMsg.details)
							lines.push(
								...this.wrap(JSON.stringify(cMsg.details, null, 2), iw),
							);
						return lines;
					},
				};
			}

			if (role === "branchSummary" || role === "compactionSummary") {
				const label =
					role === "branchSummary" ? "Branch Summary" : "Compaction Summary";
				return {
					title: `#${index} ${label}`,
					badge: entry.id,
					expanded: false,
					rawData: raw,
					renderLines: (w) =>
						this.wrap(
							this.textOf((msg as { content: unknown }).content) || "(empty)",
							w - 4,
						),
				};
			}

			// Fallback for unknown message roles
			return {
				title: `#${index} ${role}`,
				badge: entry.id,
				expanded: false,
				rawData: raw,
				renderLines: (w) => this.wrap(JSON.stringify(msg, null, 2), w - 4),
			};
		}

		// Non-message entry types
		if (entry.type === "compaction") {
			return {
				title: `#${index} Compaction`,
				badge: entry.id,
				expanded: false,
				rawData: raw,
				renderLines: (w) => {
					const iw = w - 4;
					const lines: string[] = [];
					if (entry.tokensBefore)
						lines.push(
							this.kv("Tokens Before", entry.tokensBefore.toLocaleString(), iw),
						);
					if (entry.firstKeptEntryId)
						lines.push(this.kv("First Kept", entry.firstKeptEntryId, iw));
					if (entry.summary) {
						lines.push("");
						lines.push(...this.wrap(entry.summary, iw));
					}
					return lines;
				},
			};
		}

		if (entry.type === "branch_summary") {
			return {
				title: `#${index} Branch Summary`,
				badge: entry.id,
				expanded: false,
				rawData: raw,
				renderLines: (w) => {
					const iw = w - 4;
					const lines: string[] = [];
					if (entry.fromId) lines.push(this.kv("From", entry.fromId, iw));
					if (entry.summary) lines.push(...this.wrap(entry.summary, iw));
					return lines;
				},
			};
		}

		if (entry.type === "model_change") {
			return {
				title: `#${index} Model Change`,
				badge: `${entry.provider}/${entry.modelId}`,
				expanded: false,
				rawData: raw,
				renderLines: (w) => [
					this.kv("Provider", entry.provider ?? "?", w - 4),
					this.kv("Model", entry.modelId ?? "?", w - 4),
				],
			};
		}

		if (entry.type === "thinking_level_change") {
			return {
				title: `#${index} Thinking: ${entry.thinkingLevel ?? "?"}`,
				badge: entry.thinkingLevel,
				expanded: false,
				rawData: raw,
				renderLines: (w) => [
					this.kv("Level", entry.thinkingLevel ?? "?", w - 4),
				],
			};
		}

		if (entry.type === "custom") {
			return {
				title: `#${index} Custom: ${entry.customType ?? "?"}`,
				badge: entry.id,
				expanded: false,
				rawData: raw,
				renderLines: (w) =>
					this.wrap(JSON.stringify(entry.data, null, 2), w - 4),
			};
		}

		if (entry.type === "label") {
			return {
				title: `#${index} Label: ${entry.label ?? "(cleared)"}`,
				badge: entry.id,
				expanded: false,
				rawData: raw,
				renderLines: (w) => {
					const lines: string[] = [];
					if (entry.targetId)
						lines.push(this.kv("Target", entry.targetId, w - 4));
					lines.push(this.kv("Label", entry.label ?? "(cleared)", w - 4));
					return lines;
				},
			};
		}

		if (entry.type === "session_info") {
			return {
				title: `#${index} Session Info`,
				badge: entry.name,
				expanded: false,
				rawData: raw,
				renderLines: (w) => [this.kv("Name", entry.name ?? "(none)", w - 4)],
			};
		}

		// Generic fallback
		return {
			title: `#${index} ${entry.type}`,
			badge: entry.id,
			expanded: false,
			rawData: raw,
			renderLines: (w) => this.wrap(JSON.stringify(entry, null, 2), w - 4),
		};
	}

	// --- Helpers ---

	private kv(key: string, value: string, _iw: number): string {
		return `${this.theme.fg("accent", key)}: ${this.theme.fg("text", value)}`;
	}

	private wrap(text: string, maxWidth: number): string[] {
		if (maxWidth < 10) maxWidth = 10;
		const result: string[] = [];
		for (const rawLine of text.split("\n")) {
			if (rawLine.length === 0) {
				result.push("");
				continue;
			}
			let rem = rawLine;
			while (rem.length > maxWidth) {
				result.push(rem.slice(0, maxWidth));
				rem = rem.slice(maxWidth);
			}
			result.push(rem);
		}
		return result;
	}

	private pushCapped(target: string[], source: string[], max: number) {
		if (source.length > max) {
			target.push(...source.slice(0, max));
			target.push(
				this.theme.fg(
					"warning",
					`  ... ${source.length - max} more lines truncated`,
				),
			);
		} else {
			target.push(...source);
		}
	}

	private textOf(content: unknown): string {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return (content as ContentBlock[])
			.filter((b): b is TextBlock => b.type === "text" && "text" in b)
			.map((b) => b.text)
			.join("\n");
	}

	private textPartsOf(content: ContentBlock[]): string[] {
		return content
			.filter((b): b is TextBlock => b.type === "text" && "text" in b)
			.map((b) => b.text);
	}

	private thinkingOf(content: ContentBlock[]): string[] {
		return content
			.filter(
				(b): b is ThinkingBlock => b.type === "thinking" && "thinking" in b,
			)
			.map((b) => b.thinking);
	}

	private toolCallsOf(
		content: ContentBlock[],
	): { name: string; id: string; arguments: Record<string, unknown> }[] {
		return content
			.filter((b): b is ToolCallBlock => b.type === "toolCall" && "name" in b)
			.map((b) => ({
				name: b.name,
				id: b.id ?? "?",
				arguments: b.arguments ?? {},
			}));
	}

	// --- Scroll helpers ---

	/** Line position of a section header within the full rendered output */
	private sectionLinePos(sectionIdx: number, width: number): number {
		let pos = 2; // title bar + blank line
		for (let i = 0; i < sectionIdx; i++) {
			pos++; // section header line
			const s = this.sections[i];
			if (s?.expanded) {
				pos += s.renderLines(width).length + 1; // content + trailing blank
			}
		}
		return pos;
	}

	/** Total line count of full rendered content */
	private totalLines(width: number): number {
		let count = 2; // title bar + blank
		for (const s of this.sections) {
			count++; // header
			if (s.expanded) {
				count += s.renderLines(width).length + 1;
			}
		}
		return count;
	}

	/** Clamp scrollOffset so content doesn't scroll past the end */
	private clampScroll(width: number) {
		const total = this.totalLines(width);
		const vh = this.viewportHeight;
		const maxScroll = Math.max(0, total - vh);
		this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
		this.scrollOffset = Math.max(0, this.scrollOffset);
	}

	/**
	 * Ensure the selected section header is visible in the viewport.
	 * When expanding, also tries to show some of the expanded content.
	 */
	private ensureVisible(width: number, expanding = false) {
		const vh = this.viewportHeight;
		const headerLine = this.sectionLinePos(this.selectedIndex, width);

		// Scroll up if header is above viewport
		if (headerLine < this.scrollOffset) {
			this.scrollOffset = Math.max(0, headerLine - 1);
		}

		// Scroll down if header is below viewport
		if (headerLine >= this.scrollOffset + vh) {
			this.scrollOffset = headerLine - vh + 2;
		}

		// When expanding, try to show at least some content below the header
		if (expanding) {
			const section = this.sections[this.selectedIndex];
			if (section?.expanded) {
				const contentLines = section.renderLines(width).length;
				// Show header + up to (viewport - 4) lines of content
				const desiredBottom = headerLine + Math.min(contentLines, vh - 4) + 1;
				if (desiredBottom >= this.scrollOffset + vh) {
					this.scrollOffset = desiredBottom - vh + 1;
				}
			}
		}

		this.clampScroll(width);
	}

	// --- Component interface ---

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.onClose();
			return;
		}

		const width = this.tui.terminal.columns;

		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.ensureVisible(width);
				this.inv();
			}
			return;
		}

		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			if (this.selectedIndex < this.sections.length - 1) {
				this.selectedIndex++;
				this.ensureVisible(width);
				this.inv();
			}
			return;
		}

		if (
			matchesKey(data, "enter") ||
			matchesKey(data, "space") ||
			matchesKey(data, "l")
		) {
			const s = this.sections[this.selectedIndex];
			if (s) {
				s.expanded = !s.expanded;
				this.ensureVisible(width, s.expanded);
				this.inv();
			}
			return;
		}

		if (matchesKey(data, "h")) {
			const s = this.sections[this.selectedIndex];
			if (s?.expanded) {
				s.expanded = false;
				this.ensureVisible(width);
				this.inv();
			}
			return;
		}

		if (matchesKey(data, "home") || matchesKey(data, "g")) {
			this.selectedIndex = 0;
			this.scrollOffset = 0;
			this.inv();
			return;
		}

		if (matchesKey(data, "end") || data === "G") {
			this.selectedIndex = this.sections.length - 1;
			this.ensureVisible(width);
			this.inv();
			return;
		}

		if (matchesKey(data, "c")) {
			for (const s of this.sections) s.expanded = false;
			this.ensureVisible(width);
			this.inv();
			return;
		}

		if (matchesKey(data, "e")) {
			for (const s of this.sections) s.expanded = true;
			this.ensureVisible(width);
			this.inv();
			return;
		}

		// Toggle display mode
		if (matchesKey(data, "tab")) {
			this.mode = this.mode === "pretty" ? "json" : "pretty";
			this.inv();
			return;
		}

		// Half-page scroll
		if (matchesKey(data, "ctrl+u")) {
			const half = Math.floor(this.viewportHeight / 2);
			this.scrollOffset = Math.max(0, this.scrollOffset - half);
			this.inv();
			return;
		}

		if (matchesKey(data, "ctrl+d")) {
			const half = Math.floor(this.viewportHeight / 2);
			this.scrollOffset += half;
			this.clampScroll(width);
			this.inv();
			return;
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const t = this.theme;
		const allLines: string[] = [];

		// Title bar
		const modeLabel = this.mode === "json" ? " [JSON] " : " [Pretty] ";
		const title = ` Context Inspector${modeLabel}`;
		const totalBorder = Math.max(0, width - title.length);
		const half = Math.floor(totalBorder / 2);
		allLines.push(
			t.fg(
				"accent",
				`${"─".repeat(half)}${t.bold(title)}${"─".repeat(totalBorder - half)}`,
			),
		);
		allLines.push("");

		// Sections
		for (let i = 0; i < this.sections.length; i++) {
			const section = this.sections[i];
			if (!section) continue;
			const selected = i === this.selectedIndex;
			const arrow = section.expanded ? "▼" : "▶";
			const prefix = selected ? t.fg("accent", "❯ ") : "  ";
			const arrowS = section.expanded
				? t.fg("success", arrow)
				: t.fg("muted", arrow);
			const titleS = selected
				? t.fg("accent", t.bold(section.title))
				: t.fg("text", section.title);
			const badge = section.badge ? t.fg("dim", ` [${section.badge}]`) : "";

			allLines.push(
				truncateToWidth(`${prefix}${arrowS} ${titleS}${badge}`, width),
			);

			if (section.expanded) {
				const content =
					this.mode === "json"
						? this.wrap(JSON.stringify(section.rawData, null, 2), width - 4)
						: section.renderLines(width);
				for (const line of content) {
					allLines.push(truncateToWidth(`    ${line}`, width));
				}
				allLines.push("");
			}
		}

		// Clamp scroll and slice to exactly viewport height
		this.clampScroll(width);
		const vh = this.viewportHeight;
		const visible = allLines.slice(this.scrollOffset, this.scrollOffset + vh);

		// Help bar
		visible.push("");
		visible.push(
			t.fg(
				"dim",
				truncateToWidth(
					" ↑↓/jk navigate • enter/space/l expand • h collapse • c/e collapse/expand all • g/G top/bottom • ctrl+u/d scroll • tab pretty/json • q/esc close",
					width,
				),
			),
		);
		visible.push(t.fg("accent", "─".repeat(width)));

		this.cachedWidth = width;
		this.cachedLines = visible;
		return visible;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private inv() {
		this.invalidate();
		this.tui.requestRender();
	}
}
