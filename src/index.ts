import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { VoloBot } from './bot/volo_bot';
import { BotHelper } from './bot/helper';
import { CLIArgs } from './config/cliargs';
import { CommandLine } from './utils/commandline';
import { pdfGenerator } from './utils/pdf_generator';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
  VoiceState,
  VoiceChannel
} from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection
} from '@discordjs/voice';

dotenv.config();

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const PLAYER_MAP_FILE_PATH = process.env.PLAYER_MAP_FILE_PATH;
const GUILD_ID = process.env.GUILD_ID!;

// Configure logging
function configureLogging(): void {
  const logDirectory = path.join(process.cwd(), '.logs', 'transcripts');
  const pdfDirectory = path.join(process.cwd(), '.logs', 'pdfs');
  
  if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
  }
  if (!fs.existsSync(pdfDirectory)) {
    fs.mkdirSync(pdfDirectory, { recursive: true });
  }

  const currentDate = new Date().toISOString().split('T')[0];
  const logFilename = path.join(logDirectory, `${currentDate}-transcription.log`);
  
  // Set up transcription logger (simplified - would use winston or similar in production)
  console.log(`Logging to ${logFilename}`);
}

async function main(): Promise<void> {
  const args = CommandLine.readCommandLine();
  CLIArgs.updateFromArgs(args);
  
  configureLogging();
  
  const bot = new VoloBot();

  // Handle voice state updates
  bot.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
    const guild = newState.guild;
    const botMember = guild.members.cache.get(bot.user!.id);
    const botVoiceState = botMember?.voice;

    // Ignore bot voice state updates (except self)
    if (newState.member?.user.bot && newState.member.id !== bot.user!.id) {
      return;
    }

    // CASE 1: A user joins a voice channel
    if (newState.channel && (!oldState.channel || oldState.channel.id !== newState.channel.id)) {
      const voiceChannel = newState.channel as VoiceChannel;
      
      // Count non-bot members
      const nonBotMembers = voiceChannel.members.filter(m => !m.user.bot);
      
      // If bot is not already connected and there are real users, join
      if (nonBotMembers.size > 0 && !botVoiceState?.channel) {
        try {
          const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
          });

          const helper = bot.guildToHelper.get(GUILD_ID) || new BotHelper(bot);
          helper.guildId = GUILD_ID;
          helper.vc = connection;
          bot.guildToHelper.set(GUILD_ID, helper);
          
          bot.startRecording();
          bot.guildIsRecording.set(GUILD_ID, true);
          
          console.log("Started Sink");
          console.log(`Joined VC: ${voiceChannel.name}`);
        } catch (e) {
          console.error(`Error joining voice channel: ${e}`);
        }
      }
    }

    // CASE 2: Someone leaves a channel
    if (oldState.channel) {
      const voiceChannel = oldState.channel;
      
      // If the bot is in that VC and it's now empty of humans, leave
      if (botVoiceState?.channel?.id === voiceChannel.id) {
        const nonBotMembers = voiceChannel.members.filter(m => !m.user.bot);
        if (nonBotMembers.size === 0) {
          const helper = bot.guildToHelper.get(GUILD_ID);
          if (helper && helper.vc) {
            helper.vc.destroy();
            helper.guildId = null;
            helper.setVc(null);
            bot.guildToHelper.delete(GUILD_ID);
            console.log(`Left VC: ${voiceChannel.name}`);
          }
        }
      }
      
      // If bot left the channel, clean up sink
      if (newState.member?.id === bot.user!.id && (!newState.channel || newState.channel.id !== oldState.channel.id)) {
        bot._closeAndCleanSinkForGuild(GUILD_ID);
      }
    }
  });

  // Register slash commands
  const connectCommand = new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Add The Listener to your voice party.');

  const scribeCommand = new SlashCommandBuilder()
    .setName('scribe')
    .setDescription('Start listening.');

  const stopCommand = new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop listening');

  const disconnectCommand = new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('The Listener leaves your party');

  const generatePdfCommand = new SlashCommandBuilder()
    .setName('generate_pdf')
    .setDescription('Generate a PDF of the transcriptions.');

  const updatePlayerMapCommand = new SlashCommandBuilder()
    .setName('update_player_map')
    .setDescription('Updates the player_map. If `PLAYER_MAP_FILE_PATH` is defined writes info to that location.');

  const helpCommand = new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the help message.');

  bot.on('ready', async () => {
    await bot.onReady();
    
    // Register commands
    const commands = [
      connectCommand,
      scribeCommand,
      stopCommand,
      disconnectCommand,
      generatePdfCommand,
      updatePlayerMapCommand,
      helpCommand
    ];
    
    try {
      await bot.application?.commands.set(commands, GUILD_ID);
      console.log('Slash commands registered!');
    } catch (error) {
      console.error('Error registering commands:', error);
    }
  });

  // Handle interactions
  bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const ctx = interaction as ChatInputCommandInteraction;

    if (ctx.commandName === 'connect') {
      if (!bot._isReady) {
        await ctx.reply({ content: "No connection, Try again shortly.", ephemeral: true });
        return;
      }
      
      const authorVc = ctx.member?.voice;
      if (!authorVc || !('channel' in authorVc)) {
        await ctx.reply({ content: "You have not joined a party.", ephemeral: true });
        return;
      }

      try {
        const guildId = ctx.guildId!;
        const voiceChannel = authorVc.channel as VoiceChannel;
        
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guildId,
          adapterCreator: ctx.guild!.voiceAdapterCreator,
        });

        const helper = bot.guildToHelper.get(guildId) || new BotHelper(bot);
        helper.guildId = guildId;
        helper.vc = connection;
        bot.guildToHelper.set(guildId, helper);
        
        await ctx.reply({ content: "success", ephemeral: true });
      } catch (e: any) {
        await ctx.reply({ content: `${e}`, ephemeral: true });
      }
    }

    if (ctx.commandName === 'scribe') {
      await ctx.deferReply({ ephemeral: true });
      
      const connectCommand = bot.application?.commands.cache.find(cmd => cmd.name === "connect");
      const connectText = connectCommand ? `</connect:${connectCommand.id}>` : "`/connect`";
      
      if (!bot.guildToHelper.get(ctx.guildId!)) {
        await ctx.editReply({ content: `Well, that's. I dont seem to be in your party. How about I join? ${connectText}` });
        return;
      }
      
      if (bot.guildIsRecording.get(ctx.guildId!)) {
        await ctx.editReply({ content: "I'm already listening" });
        return;
      }
      
      bot.startRecording();
      await ctx.editReply({ content: "Begun listening" });
    }

    if (ctx.commandName === 'stop') {
      const guildId = ctx.guildId!;
      const helper = bot.guildToHelper.get(guildId);
      
      if (!helper) {
        await ctx.reply({ content: "I dont seem to be in your party.", ephemeral: true });
        return;
      }

      const botVc = helper.vc;
      if (!botVc) {
        await ctx.reply({ content: "I dont seem to be in your party.", ephemeral: true });
        return;
      }

      if (!bot.guildIsRecording.get(guildId)) {
        await ctx.reply({ content: "Listening was not started", ephemeral: true });
        return;
      }

      await ctx.deferReply({ ephemeral: true });
      
      if (bot.guildIsRecording.get(guildId)) {
        const transcription = await bot.getTranscription(ctx);
        bot.stopRecording(ctx);
        bot.guildIsRecording.set(guildId, false);
        await ctx.editReply({ content: "Stopped listening" });
        bot.cleanupSink(ctx);
      }
    }

    if (ctx.commandName === 'disconnect') {
      const guildId = ctx.guildId!;
      const idExists = bot.guildToHelper.get(guildId);
      
      if (!idExists) {
        await ctx.reply({ content: "I dont seem to be in your party", ephemeral: true });
        return;
      }
      
      const helper = bot.guildToHelper.get(guildId)!;
      const botVc = helper.vc;
      
      if (!botVc) {
        await ctx.reply({ content: "Huh, weird.. where am I? Maybe we should party back up.", ephemeral: true });
        return;
      }
      
      await ctx.deferReply({ ephemeral: true });
      botVc.destroy();
      helper.guildId = null;
      helper.setVc(null);
      bot.guildToHelper.delete(guildId);
      await ctx.editReply({ content: "Disconnecting..." });
    }

    if (ctx.commandName === 'generate_pdf') {
      const guildId = ctx.guildId!;
      const helper = bot.guildToHelper.get(guildId);
      
      if (!helper) {
        await ctx.reply({ content: "I dont seem to be in your party.", ephemeral: true });
        return;
      }
      
      await ctx.deferReply({ ephemeral: true });
      const transcription = await bot.getTranscription(ctx);
      
      if (!transcription || transcription.length === 0) {
        await ctx.editReply({ content: "I'm not listening" });
        return;
      }
      
      const pdfFilePath = await pdfGenerator(transcription);
      
      if (fs.existsSync(pdfFilePath)) {
        try {
          const pdfFile = {
            attachment: pdfFilePath,
            name: "session_transcription.pdf"
          };
          await ctx.editReply({ 
            content: "Here is the transcription from this session:",
            files: [pdfFile]
          });
          // Clean up file after sending
          setTimeout(() => {
            fs.unlinkSync(pdfFilePath);
          }, 5000);
        } catch (e) {
          console.error(`Error sending PDF: ${e}`);
        }
      } else {
        await ctx.editReply({ content: "No transcription file could be generated." });
      }
    }

    if (ctx.commandName === 'update_player_map') {
      if (bot.guildIsRecording.get(ctx.guildId!)) {
        await ctx.reply({ content: "I'm sorry, I am already scribing for a set of true names ..", ephemeral: true });
        return;
      }
      
      try {
        await bot.updatePlayerMap(ctx);
        await ctx.reply({ content: "Player map has been updated.", ephemeral: true });
      } catch (e: any) {
        await ctx.reply({ content: `Unable to update player_map.yml.:\n${e}`, ephemeral: true });
        throw e;
      }
    }

    if (ctx.commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle("The Listener Help 📖")
        .setDescription("Summon The Listener's Wisdom")
        .setColor(0x0099FF)
        .addFields(
          { name: "/connect", value: "Connect to your voice channel.", inline: true },
          { name: "/disconnect", value: "Disconnect from your voice channel.", inline: true },
          { name: "/scribe", value: "Transcribe the voice channel.", inline: true },
          { name: "/stop", value: "Stop the transcription.", inline: true },
          { name: "/generate_pdf", value: "Generate a PDF of the transcriptions.", inline: true },
          { name: "/help", value: "Show the help message.", inline: true }
        );

      await ctx.reply({ embeds: [embed], ephemeral: true });
    }
  });

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log("^C received, shutting down...");
    await bot.stopAndCleanup();
    await bot.destroy();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log("SIGTERM received, shutting down...");
    await bot.stopAndCleanup();
    await bot.destroy();
    process.exit(0);
  });

  // Start the bot
  try {
    await bot.login(DISCORD_BOT_TOKEN);
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
}

main().catch(console.error);

