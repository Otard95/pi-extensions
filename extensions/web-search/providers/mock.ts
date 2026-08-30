import { type Static, Type } from "@sinclair/typebox";
import { Result } from "../../../utils/monad/result.js";
import type {
	ProviderUnavailableError,
	SearchContext,
	SearchProvider,
	SearchProviderError,
	SearchProviderResult,
	SearchRequest,
} from "../types.js";

const MockProviderSettingsSchema = Type.Object({
	message: Type.Optional(Type.String()),
});

type MockProviderSettings = Static<typeof MockProviderSettingsSchema>;

export class MockProvider implements SearchProvider {
	static readonly settingsSchema = MockProviderSettingsSchema;

	readonly label = "Mock Search";

	constructor(private readonly settings: MockProviderSettings) {}

	async checkAvailability(): Promise<Result<void, ProviderUnavailableError>> {
		return Result.Ok(undefined);
	}

	async search(
		request: SearchRequest,
		_context: SearchContext,
	): Promise<Result<SearchProviderResult, SearchProviderError>> {
		return Result.Ok({
			payload: {
				kind: "results",
				results: [
					{
						title: `Mock result for "${request.query}"`,
						url: "https://example.com/mock-search",
						snippet: this.settings.message ?? "Mock provider response.",
					},
				],
			},
		});
	}
}
