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

export class ModeManager {
	activeMode: ModeConfig | null = null;

	/** Mode name as of the last LLM turn — used to detect switches. */
	previousModeName: string | null = null;

	/**
	 * Snapshot of active tools taken when transitioning from unmanaged to
	 * managed (mode with `tools`). Cleared when returning to unmanaged.
	 * A mode without `tools` is considered unmanaged for tool tracking.
	 */
	previousTools: string[] | null = null;
	private pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	// -- Tool state helpers -------------------------------------------------

	/** Whether a mode manages tools (has `tools` specified). */
	private static isManaged(
		mode: ModeConfig | null,
	): mode is ModeConfig & Required<Pick<ModeConfig, "tools">> {
		return mode?.tools != null;
	}

	// -- Activate / Deactivate ----------------------------------------------

	async activate(mode: ModeConfig, ctx: ExtensionContext): Promise<void> {
		const wasManaged = ModeManager.isManaged(this.activeMode);
		this.activeMode = mode;

		if (ModeManager.isManaged(mode)) {
			// Entering managed state — snapshot if coming from unmanaged
			if (!wasManaged) {
				this.previousTools = this.pi.getActiveTools();
			}
			this.pi.setActiveTools(mode.tools);
		} else if (wasManaged && this.previousTools) {
			// Managed → unmanaged — restore snapshot
			this.pi.setActiveTools(this.previousTools);
			this.previousTools = null;
		}
		// Unmanaged → unmanaged — no-op for tools

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
		ctx.ui.notify(
			`Mode: ${mode.name}${mode.description ? ` — ${mode.description}` : ""}`,
			"info",
		);
	}

	deactivate(ctx: ExtensionContext): void {
		const wasManaged = ModeManager.isManaged(this.activeMode);
		this.activeMode = null;

		if (wasManaged && this.previousTools) {
			this.pi.setActiveTools(this.previousTools);
			this.previousTools = null;
		}

		this.updateStatus(ctx);
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
}
