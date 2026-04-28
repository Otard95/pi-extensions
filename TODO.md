# Pi Extensions - TODO

## Completed

### ✅ Settings Management Utility (2026-04-28)

**Current state:**
- Multiple extensions duplicate `loadSettings()` logic:
  - `searxng/index.ts` - loads `searxng` key
  - `voice-input/settings.ts` - loads `voiceInput` key
  - Pattern: read `settings.json`, parse, extract key, type cast

**Proposed solution:**
```typescript
// utils/settings.ts
import { Type, type Static } from "@sinclair/typebox";

/**
 * Load typed settings from settings.json
 * 
 * @param key - Top-level key in settings.json
 * @param schema - TypeBox schema for validation (optional, type-only if omitted)
 * @returns Parsed and validated settings, or empty object if not found
 */
export function loadSettings<T>(
  key: string,
  schema?: TSchema
): T {
  // 1. Read settings.json from getAgentDir()
  // 2. Parse JSON
  // 3. Extract settings[key]
  // 4. Validate against schema (if provided)
  // 5. Return typed result
}

// Usage in extensions:
const VoiceInputSchema = Type.Object({
  modelPath: Type.Optional(Type.String()),
  modelSearchPaths: Type.Optional(Type.Array(Type.String())),
});

type VoiceInputSettings = Static<typeof VoiceInputSchema>;

const settings = loadSettings<VoiceInputSettings>("voiceInput", VoiceInputSchema);
```

**Benefits:**
- DRY - single source of truth for settings loading
- Type-safe - schema validation catches config errors early
- Consistent error handling across extensions
- Already have `@sinclair/typebox` in devDependencies

**Completed tasks:**
- [x] Create `utils/settings.ts`
- [x] Implement generic `loadSettings<T>()` with TypeBox validation
- [x] Use Result monad for explicit error handling (no silent failures)
- [x] Migrate `searxng` extension
- [x] Migrate `voice-input` extension
- [ ] Document in README (pending)
- [ ] Add tests (optional)

**Implementation notes:**
- Returns `Result<T, Error>` - no assumptions about defaults
- Callers must explicitly handle missing config via `.unwrapOr(default)`
- Errors for: missing file, missing key, invalid type, schema validation
- Schema validation errors include detailed path/message information
- No silent failures - all error cases return `Err()`

**Related:**
- TypeBox already available: `devDependencies` includes `@sinclair/typebox`
- Pattern used in tools: see `pi-coding-agent` custom tools for schema validation examples
