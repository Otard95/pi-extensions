# Voice Input Extension

Cross-platform voice-to-text transcription using whisper-cpp.

**Supported platforms:** Linux (PulseAudio/PipeWire), macOS (AVFoundation), Windows (DirectShow)

## Setup

### 1. Install whisper-cpp

See installation instructions: [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)

**Note:** This extension requires both `whisper-cli` and `ffmpeg`.

For NixOS users, this repo's flake already includes both in the devShell.

### 2. Download Whisper Model

```bash
# Download base.en model (~150MB, recommended)
mkdir -p ~/.local/share/whisper
cd ~/.local/share/whisper
whisper-cpp-download-ggml-model base.en
```

Or tiny model (~75MB, faster but less accurate):
```bash
whisper-cpp-download-ggml-model tiny.en
```

### 3. Model Configuration (Optional)

The extension auto-detects models in platform-specific locations:

**Linux:**
- `~/.local/share/whisper/` (recommended)
- `/usr/local/share/whisper/`
- `/usr/share/whisper/`

**macOS:**
- `~/Library/Application Support/whisper/` (recommended)
- `/Library/Application Support/whisper/`
- `/usr/local/share/whisper/`

**Windows:**
- `%LOCALAPPDATA%\whisper\` (recommended)
- `%APPDATA%\whisper\`
- `%PROGRAMDATA%\whisper\`

**Custom configuration** (add to `~/.config/pi/settings.json` or `.pi/settings.json`):

```json
{
  "voiceInput": {
    "modelPath": "/custom/path/to/ggml-base.en.bin",
    "modelSearchPaths": [
      "/additional/search/path",
      "/another/path"
    ],
    "cleanup": {
      "enabled": true,
      "model": "anthropic/claude-haiku-4-5"
    }
  }
}
```

**Settings:**
- `modelPath` - Absolute path to model file (skips auto-detection)
- `modelSearchPaths` - Additional directories to search (checked before defaults)
- `cleanup.enabled` - Enable LLM cleanup of transcriptions (default: true)
- `cleanup.model` - Model override for cleanup (default: auto-pick fast model)

## Usage

### Voice Recording

1. Press `Ctrl+.` → starts recording
2. Speak into microphone
3. Press `Ctrl+.` again → stops & transcribes
4. **Automatic cleanup** - LLM cleans up spoken language artifacts
5. Text inserted at cursor

### Transcription Cleanup

By default, transcriptions are automatically cleaned up using a fast LLM (e.g., Claude Haiku) to:

- Remove filler words (um, uh, like, you know)
- Fix grammar and punctuation
- Make sentences more concise
- **Preserve original meaning** - does NOT rephrase or reinterpret

The cleanup agent receives recent conversation context to better understand what you're saying.

**Important:** The cleanup is conservative - it's better to keep text slightly rough than to change your intended meaning.

To disable cleanup:
```json
{
  "voiceInput": {
    "cleanup": { "enabled": false }
  }
}
```

### Commands

**`/voice-config`** - Show current configuration
- Displays model path (configured or auto-detected)
- Shows custom search paths
- Provides setup instructions if model not found

**`/transcribe-file <path>`** - Transcribe existing audio file
- Useful for testing/debugging
- Accepts path to any .wav file

## Requirements

- [`whisper-cpp`](https://github.com/ggml-org/whisper.cpp) - transcription (`whisper-cli` binary)
- `ffmpeg` - audio recording (with platform-specific audio support)
- Microphone access

**Platform-specific:**
- **Linux:** PulseAudio or PipeWire
- **macOS:** AVFoundation (built into macOS)
- **Windows:** DirectShow (built into Windows)

## Troubleshooting

**Model not found:**
```bash
# Download model using whisper-cpp command
cd ~/.local/share/whisper
whisper-cpp-download-ggml-model base.en
```

**Audio device issues:**

Linux (PulseAudio/PipeWire):
```bash
# Test microphone
ffmpeg -f pulse -i default -t 5 test.wav

# List sources
pactl list sources
```

macOS:
```bash
# Test microphone
ffmpeg -f avfoundation -i :0 -t 5 test.wav

# List audio devices
ffmpeg -f avfoundation -list_devices true -i ""
```

Windows:
```cmd
REM Test microphone
ffmpeg -f dshow -i audio= -t 5 test.wav

REM List audio devices
ffmpeg -f dshow -list_devices true -i dummy
```
