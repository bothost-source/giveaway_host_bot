require('dotenv').config();

module.exports = {
  // Bot
  BOT_TOKEN: process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',

  // Webhook (for Render)
  PORT: process.env.PORT || 3000,
  WEBHOOK_URL: process.env.WEBHOOK_URL || 'https://your-app.onrender.com',

  // Database
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/giveawaybot',

  // Bot Owner (YOU)
  OWNER_ID: parseInt(process.env.OWNER_ID) || 0,
  OWNER_USERNAME: process.env.OWNER_USERNAME || 'LORDTARRIFIC',
  OWNER_CHANNEL: process.env.OWNER_CHANNEL || '@LORDTARRIFIC',

  // Welcome Image URL (link to your welcome image)
  WELCOME_IMAGE: process.env.WELCOME_IMAGE || '',

  // Giveaway Types
  GIVEAWAY_TYPES: {
    RANDOM: 'random',
    REFERRAL: 'referral',
    CAPTION: 'caption',
    REACTION: 'reaction',
    COMMENT: 'comment',
    SHARE: 'share',
    FIRST_TO_DM: 'first_to_dm',
    NAME_VOTE: 'name_vote',
    AUTO_DRAW: 'auto_draw'
  },

  // Pricing
  SPONSOR_PRICE_USD: 10,
  SPONSOR_PRICE_STARS: 150,

  // Defaults
  DEFAULT_WINNERS: 1,
  MAX_WINNERS: 50,
  MAX_DURATION_DAYS: 30,

  // Messages
  BOT_NAME: 'GIVEAWAY BOT'
};
