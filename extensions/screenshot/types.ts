/**
 * Screenshot Extension – shared types
 *
 * Strategy interfaces for layout (window listing) and capture providers.
 * Each provider self-reports compatibility and caches the result.
 */

// ── Geometry ──────────────────────────────────────────────────────────────────

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

// ── Layout Provider (window listing) ──────────────────────────────────────────

export interface MonitorInfo {
	id: string;
	name: string;
	rect: Rect;
	scale: number;
	activeWorkspace: string;
}

export interface WindowInfo {
	/** Platform-specific window identifier */
	id: string;
	title: string;
	appName: string;
	pid?: number;
	rect: Rect;
	focused: boolean;
	/** Window is on the active workspace of its monitor → actually visible on screen */
	visible: boolean;
	workspace: string;
	monitor: string;
}

export interface LayoutResult {
	monitors: MonitorInfo[];
	windows: WindowInfo[];
}

export interface LayoutProvider {
	readonly name: string;
	/** Resolve binaries, check env. Caches result after first call. */
	isCompatible(): Promise<boolean>;
	getLayout(): Promise<LayoutResult>;
}

// ── Capture Provider ──────────────────────────────────────────────────────────

export interface CaptureResult {
	/** Path to the captured image on disk */
	path: string;
	format: "png" | "jpg";
}

export interface CaptureProvider {
	readonly name: string;
	/** Resolve binaries, check env. Caches result after first call. */
	isCompatible(): Promise<boolean>;
	/** Capture a specific region in global coordinates */
	captureRegion(rect: Rect): Promise<CaptureResult>;
	/** Capture the entire desktop (all outputs) */
	captureAll(): Promise<CaptureResult>;
}
