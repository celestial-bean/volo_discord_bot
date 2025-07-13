import discord
import os
from dotenv import load_dotenv
import logging

# At the top of your test_bot.py
logging.basicConfig(level=logging.DEBUG)

load_dotenv()
TOKEN = os.getenv("DISCORD_BOT_TOKEN")

intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f"✅ Logged in as {client.user}")

@client.event
async def on_message(message):
    if message.author == client.user:
        return

    if message.content.startswith("!join"):
        if message.author.voice and message.author.voice.channel:
            try:
                vc = await message.author.voice.channel.connect()
                await message.channel.send("✅ Connected to voice.")
            except Exception as e:
                await message.channel.send(f"❌ Failed: {type(e).__name__}: {e}")
        else:
            await message.channel.send("❌ You're not in a voice channel.")

    elif message.content.startswith("!leave"):
        if message.guild.voice_client:
            await message.guild.voice_client.disconnect()
            await message.channel.send("👋 Disconnected.")
        else:
            await message.channel.send("❌ I'm not in a voice channel.")

client.run(TOKEN)
