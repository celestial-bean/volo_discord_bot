# Migration Guide: Python to TypeScript

This guide outlines the key differences and changes when migrating from the Python version to the TypeScript version of the V.O.L.O Discord bot.

## Key Changes

### 1. **Discord Library**
- **Python:** Pycord (discord.py fork)
- **TypeScript:** Discord.js v14

### 2. **Voice Handling**
- **Python:** Uses Pycord's `start_recording()` with custom sinks
- **TypeScript:** Uses `@discordjs/voice` with `VoiceReceiver` and audio streams

### 3. **Audio Transcription**
- **Python:** Uses `faster-whisper` for local transcription or OpenAI API
- **TypeScript:** Currently uses OpenAI API (local transcription with @xenova/transformers can be added)

### 4. **PDF Generation**
- **Python:** Uses ReportLab
- **TypeScript:** Uses PDFKit

### 5. **Configuration**
- **Python:** Uses PyYAML
- **TypeScript:** Uses js-yaml

### 6. **Async/Await**
- Both versions use async/await, but TypeScript has better type safety

## File Structure Comparison

### Python Structure
```
main.py
src/
  bot/
    volo_bot.py
    helper.py
  sinks/
    whisper_sink.py
  config/
    cliargs.py
  utils/
    commandline.py
    pdf_generator.py
```

### TypeScript Structure
```
src/
  index.ts (replaces main.py)
  bot/
    volo_bot.ts
    helper.ts
  sinks/
    whisper_sink.ts
  config/
    cliargs.ts
  utils/
    commandline.ts
    pdf_generator.ts
  types/
    index.ts (new - type definitions)
```

## Implementation Notes

### Completed
- ✅ Bot initialization and event handling
- ✅ Slash command registration and handling
- ✅ Voice channel connection/disconnection
- ✅ Basic audio transcription setup
- ✅ PDF generation
- ✅ Player map management
- ✅ ChatGPT integration
- ✅ Voice state update handling

### Needs Additional Work
- ⚠️ **Local Transcription:** The local Whisper transcription using @xenova/transformers needs to be fully implemented
- ⚠️ **Audio Playback:** TTS and music playback features need implementation using Discord.js voice features
- ⚠️ **Voice Commands:** Some voice-activated commands (like "skibidi toilet", "diggin in yo butt") need audio playback implementation
- ⚠️ **Audio Processing:** The audio buffer handling and WAV conversion may need refinement

## Environment Variables

The environment variables remain largely the same, but note:
- `TRANSCRIPTION_METHOD` should be set to `"openai"` for OpenAI API or `"local"` for local (when implemented)

## Running the Bot

### Python Version
```bash
python main.py
```

### TypeScript Version
```bash
npm install
npm run build
npm start
```

## Key Code Differences

### Voice Connection

**Python (Pycord):**
```python
vc = await voice_channel.connect()
vc.start_recording(whisper_sink, on_stop_record_callback)
```

**TypeScript (Discord.js):**
```typescript
const connection = joinVoiceChannel({
  channelId: voiceChannel.id,
  guildId: guildId,
  adapterCreator: guild.voiceAdapterCreator,
});
const receiver = connection.receiver;
receiver.subscribe(userId, { ... });
```

### Slash Commands

**Python:**
```python
@bot.slash_command(name="connect", description="...")
async def connect(ctx: discord.context.ApplicationContext):
    ...
```

**TypeScript:**
```typescript
const connectCommand = new SlashCommandBuilder()
  .setName('connect')
  .setDescription('...');

bot.on('interactionCreate', async (interaction) => {
  if (interaction.commandName === 'connect') {
    ...
  }
});
```

## Next Steps

1. **Install Dependencies:** Run `npm install`
2. **Configure Environment:** Set up your `.env` file
3. **Test Basic Functionality:** Test voice connection and basic commands
4. **Implement Missing Features:** Add local transcription and audio playback as needed
5. **Test Thoroughly:** Test all voice commands and transcription features

## Troubleshooting

- **Voice Connection Issues:** Ensure `ffmpeg` is installed and accessible
- **Transcription Not Working:** Verify OpenAI API key is set correctly
- **Audio Not Capturing:** Check that the bot has proper permissions and is in the voice channel
- **Type Errors:** Run `npm run build` to check for TypeScript compilation errors

