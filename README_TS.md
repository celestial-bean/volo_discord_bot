# V.O.L.O Discord Transcription Bot (TypeScript)

This is the TypeScript/Node.js version of the Discord bot that transcribes voice channel audio into text in real-time. It uses Whisper (via OpenAI API or local processing) for audio transcription and is capable of handling multiple users in a voice channel.

## Features

- This project uses Discord.js (see [Discord.js Documentation](https://discord.js.org/))
- Transcribes voice channel audio to text
- Supports multiple users
- Thread-safe operations for concurrent transcriptions
- OpenAI Whisper API integration
- PDF generation for transcriptions

## Setup

To set up and run this Discord bot, follow these steps:

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Discord bot token (see [Discord Developer Portal](https://discord.com/developers/applications))
- `ffmpeg` installed and added to your system's PATH (or in the `ffmpeg` folder)

### Installation

1. **Install Dependencies:**

   ```bash
   npm install
   ```

2. **Build the Project:**

   ```bash
   npm run build
   ```

3. **Environment Variables:**

   Create a `.env` file in the root directory and add your configuration:

   ```
   DISCORD_BOT_TOKEN=your_discord_token
   GUILD_ID=your_server_id
   PLAYER_MAP_FILE_PATH=player_map.yml
   DISCORD_CHANNEL_ID=logging_channel_id
   SHUTUP_ROLE_ID=role_id_for_shutup_command
   OPENAI_API_KEY=openai_api_key
   ADMIN_ROLE_ID=id_of_admin_role
   TIMEOUT_VC_ID=id_of_timeout_voice_channel
   GENERAL_CHAT_ID=general_chat_channel_id
   LOG_CHANNEL_ID=log_channel_id
   ANT_COLONY_ROLE_ID=ant_colony_role_id
   TRANSCRIPTION_METHOD=openai
   ```

   Note: Set `TRANSCRIPTION_METHOD=openai` to use OpenAI's API, or `local` for local transcription (requires additional setup).

### Configuration

- Edit `player_map.yml` to map Discord user IDs to player and character names for transcription.
- Adjust transcription settings in `src/sinks/whisper_sink.ts` for specific Whisper model settings or other preferences.

## Usage

1. **Start the Bot:**

   ```bash
   npm start
   ```

   Or for development with auto-reload:

   ```bash
   npm run dev
   ```

2. **Bot Commands:**

   - `/connect`: Connect VOLO to your voice channel.
   - `/scribe`: Starts the transcription in the current voice channel.
   - `/stop`: Stops the transcription.
   - `/disconnect`: Disconnects the bot from the voice channel.
   - `/generate_pdf`: Generate a PDF of the transcriptions.
   - `/update_player_map`: Updates the player map with current guild members.
   - `/help`: Show the help message.

## Development

- **Build:** `npm run build`
- **Watch Mode:** `npm run watch`
- **Development:** `npm run dev` (requires ts-node)

## Differences from Python Version

- Uses Discord.js instead of Pycord
- Uses OpenAI API for transcription (local transcription with @xenova/transformers can be added)
- Uses PDFKit instead of ReportLab for PDF generation
- Uses js-yaml instead of PyYAML
- Audio handling uses @discordjs/voice instead of Pycord's voice system

## Notes

- The local transcription feature using @xenova/transformers is not fully implemented yet. Currently, the bot uses OpenAI's Whisper API for transcription.
- Audio playback features (TTS, music) need to be implemented using Discord.js voice features.
- Some voice-activated commands may need adjustment based on your server's specific needs.

## Contributing

Contributions to this project are welcome. Please ensure to follow the project's coding style and submit pull requests for any new features or bug fixes.

## License

[MIT License](LICENSE)

## Acknowledgments

- This project uses [Discord.js](https://discord.js.org/) for Discord integration
- Uses [OpenAI Whisper](https://openai.com/research/whisper) for audio transcription
- Thanks to the Discord.js community for their support and resources

