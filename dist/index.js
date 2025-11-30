"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const volo_bot_1 = require("./bot/volo_bot");
const helper_1 = require("./bot/helper");
const cliargs_1 = require("./config/cliargs");
const commandline_1 = require("./utils/commandline");
const pdf_generator_1 = require("./utils/pdf_generator");
const discord_js_1 = require("discord.js");
const voice_1 = require("@discordjs/voice");
dotenv_1.default.config();
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PLAYER_MAP_FILE_PATH = process.env.PLAYER_MAP_FILE_PATH;
const GUILD_ID = process.env.GUILD_ID;
// Configure logging
function configureLogging() {
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
async function main() {
    const args = commandline_1.CommandLine.readCommandLine();
    cliargs_1.CLIArgs.updateFromArgs(args);
    configureLogging();
    const bot = new volo_bot_1.VoloBot();
    // Handle voice state updates
    bot.on('voiceStateUpdate', async (oldState, newState) => {
        const guild = newState.guild;
        const botMember = guild.members.cache.get(bot.user.id);
        const botVoiceState = botMember?.voice;
        // Ignore bot voice state updates (except self)
        if (newState.member?.user.bot && newState.member.id !== bot.user.id) {
            return;
        }
        // CASE 1: A user joins a voice channel
        if (newState.channel && (!oldState.channel || oldState.channel.id !== newState.channel.id)) {
            const voiceChannel = newState.channel;
            // Count non-bot members
            const nonBotMembers = voiceChannel.members.filter(m => !m.user.bot);
            // If bot is not already connected and there are real users, join
            if (nonBotMembers.size > 0 && !botVoiceState?.channel) {
                try {
                    const connection = (0, voice_1.joinVoiceChannel)({
                        channelId: voiceChannel.id,
                        guildId: guild.id,
                        adapterCreator: guild.voiceAdapterCreator,
                    });
                    const helper = bot.guildToHelper.get(GUILD_ID) || new helper_1.BotHelper(bot);
                    helper.guildId = GUILD_ID;
                    helper.vc = connection;
                    bot.guildToHelper.set(GUILD_ID, helper);
                    bot.startRecording();
                    bot.guildIsRecording.set(GUILD_ID, true);
                    console.log("Started Sink");
                    console.log(`Joined VC: ${voiceChannel.name}`);
                }
                catch (e) {
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
            if (newState.member?.id === bot.user.id && (!newState.channel || newState.channel.id !== oldState.channel.id)) {
                bot._closeAndCleanSinkForGuild(GUILD_ID);
            }
        }
    });
    // Register slash commands
    const connectCommand = new discord_js_1.SlashCommandBuilder()
        .setName('connect')
        .setDescription('Add The Listener to your voice party.');
    const scribeCommand = new discord_js_1.SlashCommandBuilder()
        .setName('scribe')
        .setDescription('Start listening.');
    const stopCommand = new discord_js_1.SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop listening');
    const disconnectCommand = new discord_js_1.SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('The Listener leaves your party');
    const generatePdfCommand = new discord_js_1.SlashCommandBuilder()
        .setName('generate_pdf')
        .setDescription('Generate a PDF of the transcriptions.');
    const updatePlayerMapCommand = new discord_js_1.SlashCommandBuilder()
        .setName('update_player_map')
        .setDescription('Updates the player_map. If `PLAYER_MAP_FILE_PATH` is defined writes info to that location.');
    const helpCommand = new discord_js_1.SlashCommandBuilder()
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
        }
        catch (error) {
            console.error('Error registering commands:', error);
        }
    });
    // Handle interactions
    bot.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand())
            return;
        const ctx = interaction;
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
                const guildId = ctx.guildId;
                const voiceChannel = authorVc.channel;
                const connection = (0, voice_1.joinVoiceChannel)({
                    channelId: voiceChannel.id,
                    guildId: guildId,
                    adapterCreator: ctx.guild.voiceAdapterCreator,
                });
                const helper = bot.guildToHelper.get(guildId) || new helper_1.BotHelper(bot);
                helper.guildId = guildId;
                helper.vc = connection;
                bot.guildToHelper.set(guildId, helper);
                await ctx.reply({ content: "success", ephemeral: true });
            }
            catch (e) {
                await ctx.reply({ content: `${e}`, ephemeral: true });
            }
        }
        if (ctx.commandName === 'scribe') {
            await ctx.deferReply({ ephemeral: true });
            const connectCommand = bot.application?.commands.cache.find(cmd => cmd.name === "connect");
            const connectText = connectCommand ? `</connect:${connectCommand.id}>` : "`/connect`";
            if (!bot.guildToHelper.get(ctx.guildId)) {
                await ctx.editReply({ content: `Well, that's. I dont seem to be in your party. How about I join? ${connectText}` });
                return;
            }
            if (bot.guildIsRecording.get(ctx.guildId)) {
                await ctx.editReply({ content: "I'm already listening" });
                return;
            }
            bot.startRecording();
            await ctx.editReply({ content: "Begun listening" });
        }
        if (ctx.commandName === 'stop') {
            const guildId = ctx.guildId;
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
            const guildId = ctx.guildId;
            const idExists = bot.guildToHelper.get(guildId);
            if (!idExists) {
                await ctx.reply({ content: "I dont seem to be in your party", ephemeral: true });
                return;
            }
            const helper = bot.guildToHelper.get(guildId);
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
            const guildId = ctx.guildId;
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
            const pdfFilePath = await (0, pdf_generator_1.pdfGenerator)(transcription);
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
                }
                catch (e) {
                    console.error(`Error sending PDF: ${e}`);
                }
            }
            else {
                await ctx.editReply({ content: "No transcription file could be generated." });
            }
        }
        if (ctx.commandName === 'update_player_map') {
            if (bot.guildIsRecording.get(ctx.guildId)) {
                await ctx.reply({ content: "I'm sorry, I am already scribing for a set of true names ..", ephemeral: true });
                return;
            }
            try {
                await bot.updatePlayerMap(ctx);
                await ctx.reply({ content: "Player map has been updated.", ephemeral: true });
            }
            catch (e) {
                await ctx.reply({ content: `Unable to update player_map.yml.:\n${e}`, ephemeral: true });
                throw e;
            }
        }
        if (ctx.commandName === 'help') {
            const embed = new discord_js_1.EmbedBuilder()
                .setTitle("The Listener Help 📖")
                .setDescription("Summon The Listener's Wisdom")
                .setColor(0x0099FF)
                .addFields({ name: "/connect", value: "Connect to your voice channel.", inline: true }, { name: "/disconnect", value: "Disconnect from your voice channel.", inline: true }, { name: "/scribe", value: "Transcribe the voice channel.", inline: true }, { name: "/stop", value: "Stop the transcription.", inline: true }, { name: "/generate_pdf", value: "Generate a PDF of the transcriptions.", inline: true }, { name: "/help", value: "Show the help message.", inline: true });
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
    }
    catch (error) {
        console.error('Error starting bot:', error);
        process.exit(1);
    }
}
main().catch(console.error);
//# sourceMappingURL=index.js.map