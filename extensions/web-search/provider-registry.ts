import { parseProviderSettings } from "./provider-settings.js";
import type {
	ConfiguredSearchProvider,
	ProviderResolution,
	ProviderSetupError,
	SupportedSearchProviderClass,
} from "./types.js";
import { ProviderSetupError as SetupError } from "./types.js";

export type SupportedProviders = Record<string, SupportedSearchProviderClass>;

export function configureProviders(
	wanted: string[],
	settings: Record<string, unknown>,
	supported: SupportedProviders,
): ProviderResolution {
	const providers: ConfiguredSearchProvider[] = [];
	const issues: ProviderSetupError[] = [];

	for (const name of wanted) {
		const Provider = supported[name];
		if (!Provider) {
			issues.push(
				new SetupError(
					name,
					`Unknown web search provider "${name}"`,
					"web-search.providers",
				),
			);
			continue;
		}

		const configured = parseProviderSettings(
			name,
			Provider.settingsSchema,
			settings[name] ?? {},
		);
		if (configured.isOk()) {
			providers.push({
				name,
				provider: new Provider(configured.unwrap() as never),
			});
		} else {
			issues.push(...configured.unwrapErr().issues);
		}
	}

	return { providers, issues };
}
