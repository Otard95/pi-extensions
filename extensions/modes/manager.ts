/**
 * ModeManager — holds mode state and provides activate/deactivate/restore logic.
 *
 * Decoupled from pi registration so index.ts can wire it up to commands,
 * shortcuts, and event handlers.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { ModeConfig } from "./modes.js";
import { loadModes } from "./modes.js";

export class ModeManager {
	activeMode: ModeConfig | null = null;

	/** Mode name as of the last LLM turn — used to detect switches. */
	previousModeName: string | null = null;

	defaultTools: string[] | null = null;
	private pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	// -- Defaults -----------------------------------------------------------

	captureDefaults(): void {
		if (this.defaultTools === null) {
			try {
				this.defaultTools = this.pi.getActiveTools();
			} catch {
				try {
					this.defaultTools = this.pi.getAllTools().map((t) => t.name);
				} catch {
					// Not yet initialized — will be captured on first use
				}
			}
		}
	}

	// -- Activate / Deactivate ----------------------------------------------

	async activate(mode: ModeConfig, ctx: ExtensionContext): Promise<void> {
		this.captureDefaults();
		this.activeMode = mode;

		if (mode.tools) {
			this.pi.setActiveTools(mode.tools);
		} else if (this.defaultTools) {
			this.pi.setActiveTools(this.defaultTools);
		}

		if (mode.model) {
			const available = ctx.modelRegistry.getAvailable();
			const model = available.find((m) => m.id === mode.model);
			if (model) {
				const ok = await this.pi.setModel(model);
				if (!ok) {
					ctx.ui.notify(`No API key for model: ${mode.model}`, "warning");
				}
			} else {
				ctx.ui.notify(`Model not found: ${mode.model}`, "warning");
			}
		}

		this.updateStatus(ctx);
		this.persist();
		ctx.ui.notify(
			`Mode: ${mode.name}${mode.description ? ` — ${mode.description}` : ""}`,
			"info",
		);
	}

	deactivate(ctx: ExtensionContext): void {
		this.activeMode = null;

		if (this.defaultTools) {
			this.pi.setActiveTools(this.defaultTools);
		}

		this.updateStatus(ctx);
		this.persist();
		ctx.ui.notify("Mode cleared — default settings restored", "info");
	}

	// -- Status / Persistence -----------------------------------------------

	updateStatus(ctx: ExtensionContext): void {
		if (this.activeMode) {
			ctx.ui.setStatus(
				"modes",
				ctx.ui.theme.fg("accent", `◆ ${this.activeMode.name}`),
			);
		} else {
			ctx.ui.setStatus("modes", undefined);
		}
	}

	persist(): void {
		this.pi.appendEntry("modes", {
			activeModeName: this.activeMode?.name ?? null,
		});
	}

	// -- Restore from session -----------------------------------------------

	restore(ctx: ExtensionContext): void {
		this.captureDefaults();

		const entries = ctx.sessionManager.getEntries();
		const modeEntry = entries
			.filter(
				(e: { type: string; customType?: string }) =>
					e.type === "custom" && e.customType === "modes",
			)
			.pop() as { data?: { activeModeName: string | null } } | undefined;

		if (modeEntry?.data?.activeModeName) {
			const modes = loadModes();
			const mode = modes.find((m) => m.name === modeEntry.data?.activeModeName);
			if (mode) {
				this.activeMode = mode;
				if (mode.tools) {
					this.pi.setActiveTools(mode.tools);
				}
				// Don't re-set model on resume — user may have changed it
			}
		}

		this.updateStatus(ctx);
	}
}
