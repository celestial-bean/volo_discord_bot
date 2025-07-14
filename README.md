
# V.O.L.O Discord Transcription Bot

This project is a Discord bot that transcribes voice channel audio into text in real-time. It uses Whisper for audio transcription and is capable of handling multiple users in a voice channel.

## Features

- This project uses Pycord (see [Pycord Github](https://github.com/Pycord-Development/pycord))
- This project uses Faster Whisper (see [Faster Whisper Github](https://github.com/SYSTRAN/faster-whisper))
- Transcribes voice channel audio to text.
- Supports multiple users.
- Thread-safe operations for concurrent transcriptions.

## Setup

To set up and run this Discord bot, follow these steps:

### Prerequisites

- Python 3.7 or higher.
- Discord bot token (see [Discord Developer Portal](https://discord.com/developers/applications)).
- `ffmpeg` installed and added to your system's PATH.

### Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/your-github-username/discord-transcription-bot.git
   cd discord-transcription-bot
   ```

2. **Create a Virtual Environment (optional but recommended):**

   ```bash
   python -m venv venv
   # Activate the virtual environment
   # On Windows: venv\Scripts\activate
   # On macOS/Linux: source venv/bin/activate
   ```

3. **Install Dependencies:**

   ```bash
   pip install --user -r requirements.txt
   ```

4. **Environment Variables:**

   Create a `.env` file in the root directory and add your Discord bot token and guild ID:

   ```
   DISCORD_BOT_TOKEN= discord token
   GUILD_ID= server id
   PLAYER_MAP_FILE_PATH= player_map.yml
   DISCORD_CHANNEL_ID= logging channel id
   SHUTUP_ROLE_ID= role id for the shutup command
   OPENAI_API_KEY= openAI api key
   ADMIN_ROLE_ID= id of admin role
   TIMEOUT_VC_ID= id of timeout voice channel
   ```

### Configuration

- Edit `player_map.yml` to map Discord user IDs to player and character names for transcription.
- Adjust `audio_processing.py` for specific Whisper model settings or other preferences.

## Usage

1. **Start the Bot:**

   ```bash
   python main.py
   ```

2. **Bot Commands:**

   - `/connect`: Connect VOLO to your voice channel.
   - `/scribe`: Starts the transcription in the current voice channel.
   - `/stop`: Stops the transcription.
   - `/disconnect`: Disconnects the bot from the voice channel.

## Contributing

Contributions to this project are welcome. Please ensure to follow the project's coding style and submit pull requests for any new features or bug fixes.

## License

[MIT License](LICENSE)

## Acknowledgments

- This project uses [Whisper](https://github.com/openai/whisper) for audio transcription.
- Cuda framwork for GPU acceleration
- Thanks to the Discord.py community for their support and resources.
