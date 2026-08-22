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

  const bot = new TelegramBot(config.BOT_TOKEN, { webHook: false });

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

  // ─── Express Server (for Render webhook) ────────────
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/', (req, res) => {
    res.json({ status: 'ok', bot: me.username });
  });

  // Webhook endpoint
  app.post(`/bot${config.BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  // Start server
  app.listen(config.PORT, async () => {
    console.log(`🌐 Server running on port ${config.PORT}`);

    // Set webhook if URL is configured
    if (config.WEBHOOK_URL && config.WEBHOOK_URL.includes('render.com')) {
      const webhookUrl = `${config.WEBHOOK_URL}/bot${config.BOT_TOKEN}`;
      try {
        await bot.setWebHook(webhookUrl);
        console.log(`🔗 Webhook set: ${webhookUrl}`);
      } catch (err) {
        console.error('Webhook error:', err.message);
        console.log('⚠️  Falling back to polling...');
        bot.startPolling();
      }
    } else {
      console.log('📡 Starting polling mode...');
      bot.startPolling();
    }

    // Start cron jobs
    startJobs(bot);
  });
}

// ─── Start ──────────────────────────────────────────────
initBot().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
