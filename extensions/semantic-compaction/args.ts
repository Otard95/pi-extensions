export enum SemanticCompactKeepMode {
	Percent = "percent",
	Messages = "messages",
	Turns = "turns",
}
type SemanticCompactKeepPercentArgs = {
	type: SemanticCompactKeepMode.Percent;
	/** Percent described as an integer in the range 0-100 */
	value: number;
};
/**
 * Keep a set number of messages (not entries).
 * A message in this context is a assistant [text] or user messages
 */
type SemanticCompactKeepMessagesArgs = {
	type: SemanticCompactKeepMode.Messages;
	value: number;
};
/**
 * Keep a set number of turns.
 * A turn is all the messages from and including a user message,
 * until but not including the next user message
 */
type SemanticCompactKeepTurnArgs = {
	type: SemanticCompactKeepMode.Turns;
	value: number;
};
export type SemanticCompactArgs = {
	/**
	 * The mode describes what to compact, if its estimated token count exceed the `threshold`
	 *  - tools: Compacts consecutive tool calls (and their results)
	 *  - turns: Compacts entire turns
	 */
	mode: "tools" | "turns";
	threshold: number;
	keep:
		| SemanticCompactKeepPercentArgs
		| SemanticCompactKeepMessagesArgs
		| SemanticCompactKeepTurnArgs;
};

const DEFAULT_KEEP_VALUE = {
	[SemanticCompactKeepMode.Percent]: 20,
	[SemanticCompactKeepMode.Messages]: 50,
	[SemanticCompactKeepMode.Turns]: 2,
} as const;
const DEFAULT_ARGS: SemanticCompactArgs = {
	mode: "tools",
	threshold: 500,
	keep: {
		type: SemanticCompactKeepMode.Percent,
		value: DEFAULT_KEEP_VALUE[SemanticCompactKeepMode.Percent],
	},
};

export function parseArgs(args: string): SemanticCompactArgs {
	const parts = args.split(/\s+/).filter(Boolean);

	const finalArgs = { ...DEFAULT_ARGS, keep: { ...DEFAULT_ARGS.keep } };

	if (!parts.length) return finalArgs;

	if (parts[0] !== "keep") finalArgs.mode = parseMode(parts.shift() as string);
	if (parts[0] === "keep") finalArgs.keep = parseKeep(parts);
	if (parts.length)
		throw new Error(
			`Unable to parse arguments: ${parts.map((s) => `'${s}'`).join(", ")}.`,
		);

	return finalArgs;
}

export function parseMode(arg: string): SemanticCompactArgs["mode"] {
	switch (arg.toLowerCase()) {
		case "tool":
		case "tools":
			return "tools";
		case "turn":
		case "turns":
			return "turns";
	}
	throw new Error(`Unrecognized mode: '${arg}'`);
}
function parseKeep(args: string[]): SemanticCompactArgs["keep"] {
	args.shift();
	if (!args.length)
		throw new Error("`keep` requires at least <mode> to be specified");

	const rawMode = args.shift() as string;
	if (/\d+%/.test(rawMode)) {
		const value = parseInt(rawMode.substring(0, rawMode.length - 1), 10);
		if (!isPercent(value))
			throw new Error("Percentages must be an integer between 0 and 100");
		return { type: SemanticCompactKeepMode.Percent, value };
	}

	const mode = normalizeKeepMode(rawMode);
	if (!args.length) return { type: mode, value: DEFAULT_KEEP_VALUE[mode] };

	const value = parseModeValue(mode, args.shift() as string);

	return { type: mode, value };
}

function normalizeKeepMode(mode: string): SemanticCompactKeepMode {
	const lower = mode.toLowerCase();

	switch (lower) {
		case "p":
		case "%":
		case "perc":
		case "percent":
			return SemanticCompactKeepMode.Percent;
		case "m":
		case "msg":
		case "msgs":
		case "message":
		case "messages":
			return SemanticCompactKeepMode.Messages;
		case "t":
		case "turn":
		case "turns":
			return SemanticCompactKeepMode.Turns;
	}

	throw new Error(`Mode '${mode}' is not a recognized mode`);
}

function parseModeValue(mode: SemanticCompactKeepMode, arg: string): number {
	if (mode === SemanticCompactKeepMode.Percent) {
		if (arg.endsWith("%")) arg = arg.substring(0, arg.length - 1);
		const value = parseInt(arg);
		if (!isPercent(value))
			throw new Error("Percentages must be an integer between 0 and 100");
		return value;
	}

	const value = parseInt(arg);
	if (!Number.isInteger(value))
		throw new Error(`The value for '${mode}' mode must be an integer`);

	return value;
}

function isPercent(value: number): boolean {
	return Number.isInteger(value) && value >= 0 && value <= 100;
}
