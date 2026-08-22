# 🎉 Telegram Giveaway Bot

A powerful Telegram giveaway bot with terminal-style UI, built for channel owners.

## Features

- **9 Giveaway Types**: Random Draw, Name/Vote, Caption Contest, Referral, Reaction, Comment, Share, First-to-DM, Auto-Draw
- **Force-Join Gates**: Users must join required channels before entering
- **Button Voting**: Anonymous vote buttons on each entry in the host channel
- **Auto-Draw**: Scheduled automatic winner selection
- **Referral Tracking**: Unique referral links with confirmation
- **Sponsor System**: Paid channel promotion slots
- **Anti-Cheat**: Vote removal when users leave channels
- **Terminal UI**: Beautiful box-format messages

## Setup

### 1. Create Bot
- Message [@BotFather](https://t.me/BotFather)
- Create a new bot and copy the token

### 2. MongoDB
- Create free cluster at [MongoDB Atlas](https://www.mongodb.com/atlas)
- Get your connection string

### 3. Environment Variables
```bash
cp .env.example .env
# Edit .env with your values
```

### 4. Deploy to Render

**Option A: Webhook (Recommended)**
1. Push code to GitHub
2. Create Web Service on [Render](https://render.com)
3. Add environment variables in Render dashboard
4. Set start command: `npm start`

**Option B: Polling (Local/Dev)**
```bash
npm install
npm start
```

### 5. Bot Setup
1. Add bot as **admin** to your owner channel (`OWNER_CHANNEL`)
2. Give these permissions: Post, Edit, Delete, Pin, Restrict Members
3. Add bot as **admin** to any sponsor channels

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome menu & force-join check |
| `/admin` | Bot owner admin panel |

All other actions use **inline buttons**.

## File Structure

```
/bot
  ├── index.js          # Entry point (Express + Bot)
  ├── commands.js       # All bot commands & create flow
  ├── handlers.js       # Callbacks, messages, membership
  ├── services.js       # Business logic (DB operations)
  ├── jobs.js           # Cron jobs (auto-draw)
  ├── models.js         # MongoDB schemas
  ├── utils.js          # Box format helpers
  └── config.js         # Configuration
```

## How It Works

### For Channel Owners
1. Add bot as admin to your channel
2. DM bot → tap **🎉 Create Giveaway**
3. Forward a message from your channel
4. Select type, prize, winners, duration
5. Bot posts giveaway to your channel

### For Participants
1. Tap **🎉 Join Giveaway** on channel post
2. Join all required channels
3. Submit entry (name/caption/etc.)
4. Vote for others with **👍 Vote** button

### For Sponsors
- DM `@LORDTARRIFIC` to purchase a slot
- Your channel appears in every giveaway
- Users must join your channel to enter

## License

MIT
