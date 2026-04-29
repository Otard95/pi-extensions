/**
 * Full TypeScript diagnostics — errors, warnings, messages AND suggestions.
 *
 * Unlike `tsc --noEmit` which only surfaces errors/warnings, this script
 * uses the compiler API to also include suggestion-level diagnostics (TS80007
 * etc.) that are normally only visible via the language server.
 *
 * Usage:
 *   npm run check:full
 */

import ts from "typescript";

const CATEGORY_LABEL: Record<number, string> = {
	[ts.DiagnosticCategory.Error]: "error",
	[ts.DiagnosticCategory.Warning]: "warning",
	[ts.DiagnosticCategory.Message]: "message",
	[ts.DiagnosticCategory.Suggestion]: "suggestion",
};

function formatDiagnostic(d: ts.Diagnostic): string {
	const category = CATEGORY_LABEL[d.category] ?? "unknown";
	const code = `TS${d.code}`;
	const message = ts.flattenDiagnosticMessageText(d.messageText, "\n  ");

	if (!d.file) return `${category} ${code}: ${message}`;

	const { line, character } = d.file.getLineAndCharacterOfPosition(
		d.start ?? 0,
	);
	const file = d.file.fileName.replace(process.cwd() + "/", "");

	return `${file}:${line + 1}:${character + 1} ${category} ${code}: ${message}`;
}

const configPath = ts.findConfigFile(".", ts.sys.fileExists, "tsconfig.json");
if (!configPath) {
	console.error("Could not find tsconfig.json");
	process.exit(1);
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(
	configFile.config,
	ts.sys,
	".",
);

const program = ts.createProgram(
	parsedConfig.fileNames,
	parsedConfig.options,
);

const diagnostics: ts.Diagnostic[] = [
	...ts.getPreEmitDiagnostics(program),
];

for (const sourceFile of program.getSourceFiles()) {
	if (!sourceFile.isDeclarationFile) {
		diagnostics.push(...program.getSuggestionDiagnostics(sourceFile));
	}
}

// Sort: file → line → character
diagnostics.sort((a, b) => {
	const aFile = a.file?.fileName ?? "";
	const bFile = b.file?.fileName ?? "";
	if (aFile !== bFile) return aFile.localeCompare(bFile);
	return (a.start ?? 0) - (b.start ?? 0);
});

const counts = { error: 0, warning: 0, message: 0, suggestion: 0 };
for (const d of diagnostics) {
	const label = CATEGORY_LABEL[d.category] as keyof typeof counts;
	if (label in counts) counts[label]++;
	console.log(formatDiagnostic(d));
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (total === 0) {
	console.log("No diagnostics.");
} else {
	const summary = Object.entries(counts)
		.filter(([, n]) => n > 0)
		.map(([k, n]) => `${n} ${k}${n !== 1 ? "s" : ""}`)
		.join(", ");
	console.log(`\n${summary}`);
}

if (counts.error > 0) process.exit(1);
