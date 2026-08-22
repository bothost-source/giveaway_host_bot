const mongoose = require('mongoose');

// ─── User ─────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true, index: true },
  username: { type: String, default: '' },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  bannedChannels: [{
    channelId: { type: String, required: true },
    bannedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

// ─── Owner Channel ────────────────────────────────────
const channelSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true },
  ownerId: { type: Number, required: true, index: true },
  title: { type: String, default: '' },
  username: { type: String, default: '' },
  addedAt: { type: Date, default: Date.now }
});

// ─── Giveaway ───────────────────────────────────────────
const giveawaySchema = new mongoose.Schema({
  giveawayId: { type: String, required: true, unique: true, index: true },
  channelId: { type: String, required: true, index: true },
  ownerId: { type: Number, required: true, index: true },
  type: { 
    type: String, 
    required: true,
    enum: ['random', 'referral', 'caption', 'reaction', 'comment', 'share', 'first_to_dm', 'name_vote', 'auto_draw']
  },
  prize: { type: String, required: true },
  winnersCount: { type: Number, default: 1 },
  requiredChannels: [{ type: String }], // extra channels host adds
  sponsorChannels: [{ type: String }], // paid promos active for this giveaway
  status: { type: String, enum: ['active', 'ended', 'cancelled'], default: 'active' },
  endsAt: { type: Date },
  winners: [{
    userId: { type: Number },
    username: { type: String },
    entryId: { type: String }
  }],
  settings: {
    allowQuit: { type: Boolean, default: true },
    anonymousVoting: { type: Boolean, default: true },
    sequentialNumbering: { type: Boolean, default: true }
  },
  messageId: { type: Number }, // giveaway post message ID in channel
  entryCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// ─── Entry ──────────────────────────────────────────────
const entrySchema = new mongoose.Schema({
  entryId: { type: String, required: true, unique: true },
  giveawayId: { type: String, required: true, index: true },
  userId: { type: Number, required: true, index: true },
  username: { type: String, default: '' },
  entryNumber: { type: Number, default: 0 },
  data: { type: String, default: '' }, // name, caption, etc.
  votesCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  quitAt: { type: Date }
});

// ─── Vote ───────────────────────────────────────────────
const voteSchema = new mongoose.Schema({
  voteId: { type: String, required: true, unique: true },
  giveawayId: { type: String, required: true, index: true },
  entryId: { type: String, required: true, index: true },
  voterId: { type: Number, required: true, index: true },
  createdAt: { type: Date, default: Date.now }
});

// ─── Referral ───────────────────────────────────────────
const referralSchema = new mongoose.Schema({
  referralId: { type: String, required: true, unique: true },
  giveawayId: { type: String, required: true, index: true },
  referrerId: { type: Number, required: true },
  referredId: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'confirmed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

// ─── Sponsor ────────────────────────────────────────────
const sponsorSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true },
  channelUsername: { type: String, required: true },
  addedBy: { type: Number, required: true }, // owner who paid
  active: { type: Boolean, default: true },
  expiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = {
  User: mongoose.model('User', userSchema),
  Channel: mongoose.model('Channel', channelSchema),
  Giveaway: mongoose.model('Giveaway', giveawaySchema),
  Entry: mongoose.model('Entry', entrySchema),
  Vote: mongoose.model('Vote', voteSchema),
  Referral: mongoose.model('Referral', referralSchema),
  Sponsor: mongoose.model('Sponsor', sponsorSchema)
};
