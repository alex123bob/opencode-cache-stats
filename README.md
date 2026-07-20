# opencode-cache-stats

An [opencode](https://opencode.ai) plugin that displays a live **cache hit rate** widget
in the TUI sidebar and writes per-turn stats to a JSONL file.

## Install

```bash
npm i opencode-cache-stats
```

Then add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@alex123bob/opencode-cache-stats"]
}
```

Restart opencode. After the first assistant response, the right-column sidebar shows:

```
── Cache ─────────────────────
  Hit rate:  68.9%
  Read:      1,240 tok
  Written:     512 tok
  Raw input:   308 tok
  Output:      320 tok
  Turns:           3
```

## Stats file

Each completed turn appends one JSON line to:

```
~/.config/opencode/cache-stats.jsonl
```

Example record:

```json
{"ts":"2026-07-13T10:23:01.000Z","sessionID":"ses_abc123","providerID":"anthropic","modelID":"claude-sonnet-4-6","turn":3,"cacheRead":1240,"cacheWrite":512,"inputRaw":308,"output":320,"totalInput":2060,"hitRate":60.2}
```

## Cache hit rate definition

```
hitRate = cacheRead / (cacheRead + cacheWrite + inputRaw) × 100
```

This is the fraction of total input tokens served from cache rather than processed fresh.

## Provider compatibility

| Provider | cache read | cache write |
|---|---|---|
| Anthropic | Yes | Yes |
| OpenAI | Yes | Conditional |
| Google Vertex / Gemini | Yes | No |
| Amazon Bedrock | Yes | Yes |
| Groq | Yes | No |
| xAI (Grok) | Yes | No |
| Mistral | Yes | No |
| Cohere | No | No |

When cache data is unavailable the sidebar shows `No cache data` instead of a misleading 0%.

## License

MIT
