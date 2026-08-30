import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Result } from "../../utils/monad/result.js";
import { ProviderConfigurationError, ProviderSetupError } from "./types.js";

export function parseProviderSettings<SettingsSchema extends TSchema>(
	providerName: string,
	schema: SettingsSchema,
	settings: unknown,
): Result<Static<SettingsSchema>, ProviderConfigurationError> {
	if (Value.Check(schema, settings)) {
		return Result.Ok(settings as Static<SettingsSchema>);
	}

	const issues = [...Value.Errors(schema, settings)].map(
		(error) =>
			new ProviderSetupError(
				providerName,
				error.message,
				`web-search.${providerName}${error.path}`,
			),
	);
	return Result.Err(new ProviderConfigurationError(providerName, issues));
}
