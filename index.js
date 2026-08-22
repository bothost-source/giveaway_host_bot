require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const config = require('./config');
const { setupCallbacks, setupMessages, setupChatMember } = require('./handlers');
const { startJobs } = require('./jobs');
const { handleStart, handleAdmin } = require('./commands');

// ─── MongoDB Connection ─────────────────────────────────
async function connectDB() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.error('❌ MongoDB Error:', err.message);
    process.exit(1);
  }
}

// ─── Bot Initialization ─────────────────────────────────
async function initBot() {
  await connectDB();

  // ALWAYS use polling - more reliable for free Render tier
  const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

  // Get bot info
  const me = await bot.getMe();
  console.log(`🤖 Bot started: @${me.username}`);

  // ─── Commands ───────────────────────────────────────
  bot.onText(/\/start(\s+(.+))?/, (msg, match) => handleStart(bot, msg, match));
  bot.onText(/\/admin/, (msg) => handleAdmin(bot, msg));

  // ─── Handlers ───────────────────────────────────────
  setupCallbacks(bot);
  setupMessages(bot);
  setupChatMember(bot);

  // ─── Error Handling ─────────────────────────────────
  bot.on('polling_error', (err) => {
    console.error('Polling error:', err.message);
  });

  bot.on('error', (err) => {
    console.error('Bot error:', err.message);
  });

  // ─── Express Server (for Render health check) ───────
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/', (req, res) => {
    res.json({ status: 'ok', bot: me.username, mode: 'polling' });
  });

  // Keep-alive endpoint (Render free tier needs this)
  app.get('/ping', (req, res) => {
    res.json({ status: 'alive', time: new Date().toISOString() });
  });

  // Start server
  app.listen(config.PORT, () => {
    console.log(`🌐 Server running on port ${config.PORT}`);
    console.log('📡 Polling mode active');
  });

  // Start cron jobs
  startJobs(bot);
}

// ─── Start ──────────────────────────────────────────────
initBot().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
