const {
  User, Channel, Giveaway, Entry, Vote, Referral, Sponsor
} = require('./models');
const { generateId, getTimeLeft, formatBox, formatInfoBox } = require('./utils');
const config = require('./config');

// ─── User Management ────────────────────────────────────

async function getOrCreateUser(telegramId, username, firstName, lastName) {
  let user = await User.findOne({ telegramId });
  if (!user) {
    user = new User({ telegramId, username, firstName, lastName });
    await user.save();
  } else {
    // Update username if changed
    if (username && user.username !== username) {
      user.username = username;
      await user.save();
    }
  }
  return user;
}

async function isUserBanned(userId, channelId) {
  const user = await User.findOne({ telegramId: userId });
  if (!user) return false;
  return user.bannedChannels.some(b => b.channelId === channelId);
}

async function banUserFromChannel(userId, channelId) {
  await User.updateOne(
    { telegramId: userId },
    { $addToSet: { bannedChannels: { channelId, bannedAt: new Date() } } }
  );
}

async function unbanUserFromChannel(userId, channelId) {
  await User.updateOne(
    { telegramId: userId },
    { $pull: { bannedChannels: { channelId } } }
  );
}

// ─── Channel Management ─────────────────────────────────

async function addOwnerChannel(channelId, ownerId, title, username) {
  const existing = await Channel.findOne({ channelId });
  if (existing) {
    existing.ownerId = ownerId;
    existing.title = title;
    existing.username = username;
    await existing.save();
    return existing;
  }
  const channel = new Channel({ channelId, ownerId, title, username });
  await channel.save();
  return channel;
}

async function getOwnerChannels(ownerId) {
  return Channel.find({ ownerId }).sort({ addedAt: -1 });
}

async function removeOwnerChannel(channelId, ownerId) {
  await Channel.deleteOne({ channelId, ownerId });
}

// ─── Membership Check ───────────────────────────────────

async function checkMembership(bot, userId, channelId) {
  try {
    // Handle @username format
    let chatId = channelId;
    if (!chatId.startsWith('-') && !chatId.startsWith('@')) {
      chatId = '@' + chatId;
    }

    const member = await bot.getChatMember(chatId, userId);
    const status = member.status;
    return ['creator', 'administrator', 'member'].includes(status);
  } catch (err) {
    console.error('Membership check error:', err.message);
    return false;
  }
}

async function getAllRequiredChannels(giveaway) {
  const channels = [];

  // Host channel (first)
  channels.push({ id: giveaway.channelId, type: 'host', name: getChannelName(giveaway.channelId) });

  // Bot owner channel (always required)
  if (config.OWNER_CHANNEL) {
    channels.push({ id: config.OWNER_CHANNEL, type: 'owner', name: getChannelName(config.OWNER_CHANNEL) });
  }

  // Extra required channels from host
  if (giveaway.requiredChannels) {
    giveaway.requiredChannels.forEach(c => {
      channels.push({ id: c, type: 'required', name: getChannelName(c) });
    });
  }

  // Sponsor channels
  if (giveaway.sponsorChannels) {
    giveaway.sponsorChannels.forEach(c => {
      channels.push({ id: c, type: 'sponsor', name: getChannelName(c) });
    });
  }

  return channels;
}

function getChannelName(channelId) {
  if (!channelId) return 'Unknown';
  if (channelId.startsWith('@')) return channelId;
  if (channelId.startsWith('-100')) return '@' + channelId.replace('-100', '');
  return '@' + channelId;
}

async function checkAllMemberships(bot, userId, giveaway) {
  const channels = await getAllRequiredChannels(giveaway);
  const results = [];

  for (const ch of channels) {
    const isMember = await checkMembership(bot, userId, ch.id);
    results.push({ channel: ch.id, channelName: ch.name, type: ch.type, isMember });
  }

  const missing = results.filter(r => !r.isMember);
  return { allJoined: missing.length === 0, missing };
}

// ─── Giveaway Management ────────────────────────────────

async function createGiveaway(data) {
  const giveaway = new Giveaway({
    giveawayId: generateId('GW'),
    channelId: data.channelId,
    ownerId: data.ownerId,
    type: data.type,
    prize: data.prize,
    winnersCount: data.winnersCount || 1,
    requiredChannels: data.requiredChannels || [],
    sponsorChannels: data.sponsorChannels || [],
    // New game fields
    guessStart: data.guessStart || 0,
    guessEnd: data.guessEnd || 0,
    secretNumber: data.secretNumber || 0,
    boxCount: data.boxCount || 0,
    commentMode: data.commentMode || 'reply',
    commentKeyword: data.commentKeyword || '',
    reactionEmoji: data.reactionEmoji || '👍',
    endsAt: data.endsAt,
    settings: {
      allowQuit: true,
      anonymousVoting: true,
      sequentialNumbering: true
    }
  });

  await giveaway.save();
  return giveaway;
}

async function getGiveaway(giveawayId) {
  return Giveaway.findOne({ giveawayId });
}

async function getActiveGiveaways(channelId) {
  return Giveaway.find({ channelId, status: 'active' }).sort({ createdAt: -1 });
}

async function getOwnerGiveaways(ownerId) {
  return Giveaway.find({ ownerId }).sort({ createdAt: -1 });
}

async function cancelGiveaway(giveawayId) {
  const giveaway = await Giveaway.findOneAndUpdate(
    { giveawayId },
    { status: 'cancelled' },
    { new: true }
  );
  return giveaway;
}

async function endGiveaway(giveawayId, winners) {
  const giveaway = await Giveaway.findOneAndUpdate(
    { giveawayId },
    { status: 'ended', winners },
    { new: true }
  );
  return giveaway;
}

// ─── Entry Management ───────────────────────────────────

async function createEntry(giveawayId, userId, username, data, extra = {}) {
  // Check if already entered
  const existing = await Entry.findOne({ giveawayId, userId, quitAt: { $exists: false } });
  if (existing) return { success: false, error: 'already_entered', entry: existing };

  // Get next entry number
  const lastEntry = await Entry.findOne({ giveawayId }).sort({ entryNumber: -1 });
  const entryNumber = (lastEntry?.entryNumber || 0) + 1;

  // Get giveaway type
  const giveaway = await Giveaway.findOne({ giveawayId });
  let dmOrder = 0;

  if (giveaway && giveaway.type === 'first_to_dm') {
    const existingCount = await Entry.countDocuments({ giveawayId, quitAt: { $exists: false } });
    dmOrder = existingCount + 1;
  }

  const entry = new Entry({
    entryId: generateId('EN'),
    giveawayId,
    userId,
    username,
    entryNumber,
    data,
    dmOrder,
    guessNumber: extra.guessNumber || 0,
    guessHint: extra.guessHint || '',
    boxPicked: extra.boxPicked || 0
  });

  await entry.save();

  // Increment giveaway entry count
  await Giveaway.updateOne(
    { giveawayId },
    { $inc: { entryCount: 1 } }
  );

  return { success: true, entry };
}

async function getEntry(entryId) {
  return Entry.findOne({ entryId });
}

async function getGiveawayEntries(giveawayId) {
  return Entry.find({ giveawayId, quitAt: { $exists: false } }).sort({ entryNumber: 1 });
}

async function getUserEntry(giveawayId, userId) {
  return Entry.findOne({ giveawayId, userId, quitAt: { $exists: false } });
}

async function deleteEntry(entryId) {
  const entry = await Entry.findOneAndDelete({ entryId });
  if (entry) {
    // Remove associated votes
    await Vote.deleteMany({ entryId: entry.entryId });
    // Decrement entry count
    await Giveaway.updateOne(
      { giveawayId: entry.giveawayId },
      { $inc: { entryCount: -1 } }
    );
  }
  return entry;
}

async function quitGiveaway(giveawayId, userId) {
  const entry = await Entry.findOneAndUpdate(
    { giveawayId, userId, quitAt: { $exists: false } },
    { quitAt: new Date() },
    { new: true }
  );

  if (entry) {
    // Remove votes on this entry
    await Vote.deleteMany({ entryId: entry.entryId });
    // Decrement entry count
    await Giveaway.updateOne(
      { giveawayId },
      { $inc: { entryCount: -1 } }
    );
  }

  return entry;
}

// ─── Voting ─────────────────────────────────────────────

async function voteEntry(giveawayId, entryId, voterId) {
  // Check if already voted
  const existing = await Vote.findOne({ giveawayId, entryId, voterId });
  if (existing) return { success: false, error: 'already_voted' };

  const vote = new Vote({
    voteId: generateId('VT'),
    giveawayId,
    entryId,
    voterId
  });

  await vote.save();

  // Increment entry votes
  const entry = await Entry.findOneAndUpdate(
    { entryId },
    { $inc: { votesCount: 1 } },
    { new: true }
  );

  return { success: true, entry, vote };
}

async function removeVote(entryId, voterId) {
  const vote = await Vote.findOneAndDelete({ entryId, voterId });
  if (vote) {
    await Entry.findOneAndUpdate(
      { entryId },
      { $inc: { votesCount: -1 } }
    );
  }
  return vote;
}

async function removeAllUserVotes(giveawayId, voterId) {
  const votes = await Vote.find({ giveawayId, voterId });
  for (const vote of votes) {
    await removeVote(vote.entryId, voterId);
  }
  return votes.length;
}

async function getLeaderboard(giveawayId, limit = 10) {
  return Entry.find({ giveawayId, quitAt: { $exists: false } })
    .sort({ votesCount: -1, createdAt: 1 })
    .limit(limit);
}

// ─── Winner Selection ───────────────────────────────────

async function drawWinners(giveaway) {
  const entries = await Entry.find({ 
    giveawayId: giveaway.giveawayId, 
    quitAt: { $exists: false } 
  });

  if (entries.length === 0) return [];

  let winners = [];

  if (giveaway.type === 'name_vote' || giveaway.type === 'caption') {
    // Vote-based: sort by votes desc, then createdAt asc (first to reach)
    const sorted = entries.sort((a, b) => {
      if (b.votesCount !== a.votesCount) return b.votesCount - a.votesCount;
      return a.createdAt - b.createdAt;
    });
    winners = sorted.slice(0, giveaway.winnersCount);
  } else if (giveaway.type === 'first_to_dm') {
    // First to DM: sort by dmOrder (1 = first person who DM'd)
    const sorted = entries.sort((a, b) => a.dmOrder - b.dmOrder);
    winners = sorted.slice(0, giveaway.winnersCount);
  } else if (giveaway.type === 'referral') {
    // Referral-based: count confirmed referrals per user
    const referralCounts = {};
    for (const entry of entries) {
      const count = await Referral.countDocuments({
        giveawayId: giveaway.giveawayId,
        referrerId: entry.userId,
        status: 'confirmed'
      });
      referralCounts[entry.userId] = count;
    }

    const sorted = entries.sort((a, b) => {
      const countA = referralCounts[a.userId] || 0;
      const countB = referralCounts[b.userId] || 0;
      if (countB !== countA) return countB - countA;
      return a.createdAt - b.createdAt;
    });
    winners = sorted.slice(0, giveaway.winnersCount);
  } else {
    // Random draw
    const shuffled = entries.sort(() => 0.5 - Math.random());
    winners = shuffled.slice(0, Math.min(giveaway.winnersCount, entries.length));
  }

  const winnerData = winners.map(w => ({
    userId: w.userId,
    username: w.username,
    entryId: w.entryId
  }));

  await endGiveaway(giveaway.giveawayId, winnerData);
  return winnerData;
}

// ─── Referral Management ────────────────────────────────

async function createReferral(giveawayId, referrerId, referredId) {
  // Check if already referred by someone else for this giveaway
  const existing = await Referral.findOne({ giveawayId, referredId });
  if (existing) return { success: false, error: 'already_referred' };

  const referral = new Referral({
    referralId: generateId('RF'),
    giveawayId,
    referrerId,
    referredId,
    status: 'pending'
  });

  await referral.save();
  return { success: true, referral };
}

async function confirmReferral(giveawayId, referredId) {
  const referral = await Referral.findOneAndUpdate(
    { giveawayId, referredId, status: 'pending' },
    { status: 'confirmed' },
    { new: true }
  );
  return referral;
}

async function getReferralCount(giveawayId, referrerId) {
  return Referral.countDocuments({
    giveawayId,
    referrerId,
    status: 'confirmed'
  });
}

async function getReferralLink(giveawayId, userId, botUsername) {
  return `https://t.me/${botUsername}?start=ref_${userId}_${giveawayId}`;
}

// ─── Sponsor Management ─────────────────────────────────

async function getActiveSponsors() {
  return Sponsor.find({ active: true });
}

async function addSponsor(channelId, channelUsername, addedBy) {
  const sponsor = new Sponsor({
    channelId,
    channelUsername,
    addedBy,
    active: true
  });
  await sponsor.save();
  return sponsor;
}

async function removeSponsor(channelId) {
  await Sponsor.updateOne({ channelId }, { active: false });
}

// ─── Vote Removal on Leave ─────────────────────────────

async function handleUserLeftChannel(userId, channelId) {
  // Find active giveaways in this channel
  const giveaways = await Giveaway.find({ 
    channelId, 
    status: 'active',
    $or: [
      { type: 'name_vote' },
      { type: 'caption' }
    ]
  });

  for (const giveaway of giveaways) {
    // Remove all votes by this user in this giveaway
    const votes = await Vote.find({ giveawayId: giveaway.giveawayId, voterId: userId });
    for (const vote of votes) {
      await removeVote(vote.entryId, userId);
    }
  }

  return giveaways.length;
}

module.exports = {
  // User
  getOrCreateUser,
  isUserBanned,
  banUserFromChannel,
  unbanUserFromChannel,

  // Channel
  addOwnerChannel,
  getOwnerChannels,
  removeOwnerChannel,

  // Membership
  checkMembership,
  checkAllMemberships,
  getAllRequiredChannels,

  // Giveaway
  createGiveaway,
  getGiveaway,
  getActiveGiveaways,
  getOwnerGiveaways,
  cancelGiveaway,
  endGiveaway,

  // Entry
  createEntry,
  getEntry,
  getGiveawayEntries,
  getUserEntry,
  deleteEntry,
  quitGiveaway,

  // Vote
  voteEntry,
  removeVote,
  removeAllUserVotes,
  getLeaderboard,

  // Winners
  drawWinners,

  // Referral
  createReferral,
  confirmReferral,
  getReferralCount,
  getReferralLink,

  // Sponsor
  getActiveSponsors,
  addSponsor,
  removeSponsor,

  // Leave handler
  handleUserLeftChannel
};
