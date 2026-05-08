/**
 * Hyprland Layout Provider
 *
 * Uses `hyprctl monitors -j` and `hyprctl clients -j` to build a full layout.
 * Requires Hyprland compositor to be running.
 */

import type { LayoutProvider, LayoutResult } from "../types.js";
import { exec, isLinux, resolveBin } from "../utils.js";

// ── hyprctl JSON types ────────────────────────────────────────────────────────

interface HyprMonitor {
	id: number;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	scale: number;
	activeWorkspace: { id: number; name: string };
}

interface HyprClient {
	address: string;
	title: string;
	class: string;
	pid: number;
	at: [number, number];
	size: [number, number];
	workspace: { id: number; name: string };
	monitor: number;
	mapped: boolean;
	hidden: boolean;
	focusHistoryID: number;
}

// ── Provider ──────────────────────────────────────────────────────────────────

let compat: { ok: boolean; bin: string | null } | null = null;

async function checkCompat(): Promise<typeof compat & {}> {
	if (compat) return compat;

	if (!isLinux()) {
		compat = { ok: false, bin: null };
		return compat;
	}

	if (!process.env["HYPRLAND_INSTANCE_SIGNATURE"]) {
		compat = { ok: false, bin: null };
		return compat;
	}

	const bin = await resolveBin("hyprctl");
	compat = { ok: bin !== null, bin };
	return compat;
}

export const hyprlandLayout: LayoutProvider = {
	name: "hyprland",

	async isCompatible(): Promise<boolean> {
		return (await checkCompat()).ok;
	},

	async getLayout(): Promise<LayoutResult> {
		const { ok, bin } = await checkCompat();
		if (!ok || !bin) throw new Error("Hyprland layout provider not compatible");

		// Fetch monitors and clients in parallel
		const [monitorsResult, clientsResult] = await Promise.all([
			exec(bin, ["monitors", "-j"]),
			exec(bin, ["clients", "-j"]),
		]);

		if (monitorsResult.code !== 0) {
			throw new Error(
				`hyprctl monitors failed (exit ${monitorsResult.code}): ${monitorsResult.stderr}`,
			);
		}
		if (clientsResult.code !== 0) {
			throw new Error(
				`hyprctl clients failed (exit ${clientsResult.code}): ${clientsResult.stderr}`,
			);
		}

		const hyprMonitors = JSON.parse(monitorsResult.stdout) as HyprMonitor[];
		const hyprClients = JSON.parse(clientsResult.stdout) as HyprClient[];

		// Build monitor ID → active workspace lookup
		const activeWorkspaceByMonitor = new Map<number, number>();
		for (const m of hyprMonitors) {
			activeWorkspaceByMonitor.set(m.id, m.activeWorkspace.id);
		}

		const monitors = hyprMonitors.map((m) => ({
			id: String(m.id),
			name: m.name,
			rect: { x: m.x, y: m.y, width: m.width, height: m.height },
			scale: m.scale,
			activeWorkspace: m.activeWorkspace.name,
		}));

		const windows = hyprClients
			.filter((c) => c.mapped && !c.hidden)
			.map((c) => ({
				id: c.address,
				title: c.title,
				appName: c.class,
				pid: c.pid,
				rect: {
					x: c.at[0],
					y: c.at[1],
					width: c.size[0],
					height: c.size[1],
				},
				focused: c.focusHistoryID === 0,
				visible: activeWorkspaceByMonitor.get(c.monitor) === c.workspace.id,
				workspace: c.workspace.name,
				monitor: String(c.monitor),
			}));

		return { monitors, windows };
	},
};
