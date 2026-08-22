const config = require('./config');
const {
  getOrCreateUser, checkMembership, checkAllMemberships,
  getOwnerChannels, addOwnerChannel, createGiveaway,
  getActiveSponsors, getOwnerGiveaways, getGiveaway,
  cancelGiveaway, drawWinners, getGiveawayEntries,
  getReferralLink, getActiveGiveaways
} = require('./services');
const {
  formatBox, formatInfoBox, formatWarning, formatSuccess,
  generateId, getTimeLeft, escapeMarkdown
} = require('./utils');

// ─── State Management ───────────────────────────────────
const userStates = new Map();

function setState(userId, state, data = {}) {
  userStates.set(userId, { state, data, updatedAt: Date.now() });
}

function getState(userId) {
  return userStates.get(userId) || { state: 'idle', data: {} };
}

function clearState(userId) {
  userStates.delete(userId);
}

// ─── Helper: Safe Edit or Send ─────────────────────────
async function safeEditOrSend(bot, query, text, keyboard) {
  const chatId = query.message.chat.id;

  // If current message has photo, send new message
  if (query.message.photo) {
    return bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  try {
    return await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  } catch (err) {
    // If edit fails (e.g., message too old), send new message
    if (err.message.includes('message is not modified') || err.message.includes('message to edit not found')) {
      return bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }
    throw err;
  }
}

// ─── Helper: Send Box Message ───────────────────────────
async function sendBox(bot, chatId, text, options = {}) {
  return bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    ...options
  });
}

// ─── Helper: Build Join Buttons ─────────────────────────
function buildJoinButtons(missingChannels) {
  const buttons = missingChannels.map(ch => {
    const username = ch.startsWith('@') ? ch : '@' + ch.replace('-100', '');
    return [{ text: `📢 Join ${username}`, url: `https://t.me/${username.replace('@', '')}` }];
  });
  buttons.push([{ text: "✅ I've Joined All", callback_data: 'check_membership' }]);
  buttons.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);
  return buttons;
}

// ─── /start ─────────────────────────────────────────────
async function handleStart(bot, msg, match) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || '';
  const firstName = msg.from.first_name || '';
  const lastName = msg.from.last_name || '';

  // Save user
  await getOrCreateUser(userId, username, firstName, lastName);

  // Check force-join to owner channel
  const ownerChannel = config.OWNER_CHANNEL;
  if (ownerChannel) {
    const isMember = await checkMembership(bot, userId, ownerChannel);
    if (!isMember) {
      const text = formatWarning(
        '⚠️ ACCESS WARNING',
        '❌ Denied',
        'Must join bot channel first',
        'Join the channel then try again'
      );

      const channelUsername = ownerChannel.startsWith('@') ? ownerChannel : '@' + ownerChannel.replace('-100', '');

      return sendBox(bot, chatId, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: `📢 Join ${channelUsername}`, url: `https://t.me/${channelUsername.replace('@', '')}` }],
            [{ text: "✅ I've Joined", callback_data: "check_membership_start" }],
            [{ text: '❌ Cancel', callback_data: 'cancel' }]
          ]
        }
      });
    }
  }

  // Handle referral start
  const startParam = match && match[1] ? match[1] : '';
  if (startParam.startsWith('ref_')) {
    const parts = startParam.split('_');
    if (parts.length >= 3) {
      const referrerId = parseInt(parts[1]);
      const giveawayId = parts[2];
      // Store referral intent
      setState(userId, 'referral_pending', { referrerId, giveawayId });
    }
  }

  // Send welcome
  const welcomeText = formatInfoBox(
    '🎉 WELCOME TO GIVEAWAY BOT',
    [
      '',
      "🤖 I'm here to help channel owners",
      '   host epic giveaways:',
      '',
      '   • Name Contests  • Referral Battles',
      '   • Caption Wars   • Reaction Drops',
      '   • First-to-DM    • Auto-Draws & More!',
      '',
      '👑 Channel owners: Add me as admin',
      '   to your channel then tap below',
      '',
      '💎 Want YOUR channel featured?',
      '   DM ' + config.OWNER_USERNAME + ' — $10 or 150 ⭐',
      '',
      "⚡ Let's make someone win today!"
    ]
  );

  const keyboard = {
    inline_keyboard: [
      [{ text: '🎉 Create Giveaway', callback_data: 'create_start' }],
      [{ text: '📋 My Giveaways', callback_data: 'manage_giveaways' }],
      [{ text: '💎 Sponsor Info', callback_data: 'sponsor_info' }],
      [{ text: '❓ Help', callback_data: 'help' }]
    ]
  };

  // Send welcome image with caption if configured
  if (config.WELCOME_IMAGE) {
    return bot.sendPhoto(chatId, config.WELCOME_IMAGE, {
      caption: welcomeText,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  return sendBox(bot, chatId, welcomeText, { reply_markup: keyboard });
}

// ─── Create Giveaway Flow ───────────────────────────────

async function handleCreateStart(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  // Get owner's channels
  const channels = await getOwnerChannels(userId);

  if (channels.length === 0) {
    const text = formatWarning(
      '❌ NO CHANNELS',
      '❌ Denied',
      'You have no linked channels',
      'Forward a message from your channel'
    );

    setState(userId, 'waiting_channel_forward', {});

    const keyboard = { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel' }]] };

    if (query.message.photo) {
      return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  // Show channel selection
  const text = formatBox('📢 SELECT CHANNEL', [
    ['Action', 'Choose channel to host']
  ]);

  const keyboard = channels.map(ch => {
    const name = ch.username || ch.title || ch.channelId;
    return [{ text: name, callback_data: `select_channel_${ch.channelId}` }];
  });
  keyboard.push([{ text: '➕ Add New Channel', callback_data: 'add_channel' }]);
  keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);

  if (query.message.photo) {
    return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
  }
  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function handleSelectChannel(bot, query, channelId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  // Verify bot is admin in this channel
  try {
    const botMember = await bot.getChatMember(channelId, (await bot.getMe()).id);
    if (!botMember || !['creator', 'administrator'].includes(botMember.status)) {
      const text = formatWarning(
        '❌ ADMIN REQUIRED',
        '❌ Denied',
        'Bot is not admin in channel',
        'Add bot as admin with full rights'
      );
      return bot.editMessageText(text, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back', callback_data: 'create_start' }]]
        }
      });
    }
  } catch (err) {
    const text = formatWarning(
      '❌ CHANNEL ERROR',
      '❌ Denied',
      'Cannot verify channel',
      'Make sure bot is in the channel'
    );
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: 'create_start' }]]
      }
    });
  }

  setState(userId, 'waiting_giveaway_type', { channelId });

  const text = formatBox('🎲 SELECT TYPE', [
    ['Action', 'Choose giveaway type']
  ]);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎲 Random Draw', callback_data: 'type_random' }],
        [{ text: '🗳️ Name/Vote', callback_data: 'type_name_vote' }],
        [{ text: '📝 Caption Contest', callback_data: 'type_caption' }],
        [{ text: '👍 Reaction', callback_data: 'type_reaction' }],
        [{ text: '💬 Comment', callback_data: 'type_comment' }],
        [{ text: '📤 Share', callback_data: 'type_share' }],
        [{ text: '🏆 First to DM', callback_data: 'type_first_to_dm' }],
        [{ text: '📢 Referral', callback_data: 'type_referral' }],
        [{ text: '🎯 Auto-Draw', callback_data: 'type_auto_draw' }],
        [{ text: '🔙 Back', callback_data: 'create_start' }]
      ]
    }
  });
}

async function handleSelectType(bot, query, type) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const state = getState(userId);

  if (!state.data.channelId) {
    return handleCreateStart(bot, query);
  }

  state.data.type = type;
  setState(userId, 'waiting_prize', state.data);

  const text = formatBox('🎁 ENTER PRIZE', [
    ['Type', type.replace(/_/g, ' ').toUpperCase()],
    ['Action', 'Send the prize name']
  ]);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel' }]]
    }
  });
}

async function handlePrizeInput(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const state = getState(userId);

  if (state.state !== 'waiting_prize') return;

  const prize = msg.text.trim();
  if (!prize || prize.length < 2) {
    const text = formatWarning(
      '❌ INVALID PRIZE',
      '❌ Denied',
      'Prize name too short',
      'Send a valid prize name'
    );
    return sendBox(bot, chatId, text);
  }

  state.data.prize = prize;
  setState(userId, 'waiting_winners', state.data);

  const text = formatBox('🏆 WINNERS COUNT', [
    ['Prize', prize],
    ['Action', 'How many winners?']
  ]);

  return sendBox(bot, chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '1', callback_data: 'winners_1' },
         { text: '2', callback_data: 'winners_2' },
         { text: '3', callback_data: 'winners_3' }],
        [{ text: '5', callback_data: 'winners_5' },
         { text: '10', callback_data: 'winners_10' }],
        [{ text: '❌ Cancel', callback_data: 'cancel' }]
      ]
    }
  });
}

async function handleWinnersSelect(bot, query, winnersCount) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const state = getState(userId);

  if (state.state !== 'waiting_winners') return;

  state.data.winnersCount = parseInt(winnersCount);
  setState(userId, 'waiting_duration', state.data);

  const text = formatBox('⏳ SET DURATION', [
    ['Prize', state.data.prize],
    ['Winners', winnersCount],
    ['Action', 'How long should it run?']
  ]);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '1 Hour', callback_data: 'duration_1h' }],
        [{ text: '6 Hours', callback_data: 'duration_6h' }],
        [{ text: '12 Hours', callback_data: 'duration_12h' }],
        [{ text: '1 Day', callback_data: 'duration_1d' }],
        [{ text: '3 Days', callback_data: 'duration_3d' }],
        [{ text: '7 Days', callback_data: 'duration_7d' }],
        [{ text: '❌ Cancel', callback_data: 'cancel' }]
      ]
    }
  });
}

async function handleDurationSelect(bot, query, duration) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const state = getState(userId);

  if (state.state !== 'waiting_duration') return;

  // Parse duration
  let hours = 24;
  if (duration === '1h') hours = 1;
  else if (duration === '6h') hours = 6;
  else if (duration === '12h') hours = 12;
  else if (duration === '1d') hours = 24;
  else if (duration === '3d') hours = 72;
  else if (duration === '7d') hours = 168;

  const endsAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  state.data.endsAt = endsAt;
  state.data.durationText = duration;

  // Get active sponsors
  const sponsors = await getActiveSponsors();
  state.data.sponsorChannels = sponsors.map(s => s.channelId);

  setState(userId, 'waiting_confirm', state.data);

  const rows = [
    ['Channel', state.data.channelId],
    ['Type', state.data.type.replace(/_/g, ' ').toUpperCase()],
    ['Prize', state.data.prize],
    ['Winners', state.data.winnersCount.toString()],
    ['Duration', duration],
    ['Ends At', endsAt.toLocaleString()]
  ];

  const text = formatBox('✅ CONFIRM GIVEAWAY', rows);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Post to Channel', callback_data: 'confirm_giveaway' }],
        [{ text: '🔙 Back', callback_data: 'create_start' }],
        [{ text: '❌ Cancel', callback_data: 'cancel' }]
      ]
    }
  });
}

async function handleConfirmGiveaway(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const state = getState(userId);

  if (state.state !== 'waiting_confirm') return;

  const { channelId, type, prize, winnersCount, endsAt, sponsorChannels } = state.data;

  try {
    const giveaway = await createGiveaway({
      channelId,
      ownerId: userId,
      type,
      prize,
      winnersCount,
      endsAt,
      sponsorChannels
    });

    // Build giveaway post text
    const requiredChannels = [config.OWNER_CHANNEL, ...sponsorChannels].filter(Boolean);
    const channelList = requiredChannels.map(c => {
      const uname = c.startsWith('@') ? c : '@' + c.replace('-100', '');
      return `• ${uname}`;
    });

    let postText = formatBox(`🎉 GIVEAWAY: ${prize.toUpperCase()}`, [
      ['Type', type.replace(/_/g, ' ').toUpperCase()],
      ['Prize', prize],
      ['Winners', winnersCount.toString()],
      ['Ends In', getTimeLeft(endsAt)]
    ]);

    postText += '\n' + formatInfoBox('✅ MUST JOIN', [
      `• @${channelId.replace('-100', '')} (host)`,
      ...channelList
    ], { width: 35 });

    postText += '\n\n📝 Tap below to enter!';

    // Post to channel
    const channelMsg = await bot.sendMessage(channelId, postText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎉 Join Giveaway', callback_data: `join_${giveaway.giveawayId}` }],
          [{ text: '📊 Live Results', callback_data: `leaderboard_${giveaway.giveawayId}` }]
        ]
      }
    });

    // Save message ID
    giveaway.messageId = channelMsg.message_id;
    await giveaway.save();

    // Pin the message
    try {
      await bot.pinChatMessage(channelId, channelMsg.message_id);
    } catch (e) {
      console.log('Could not pin message:', e.message);
    }

    clearState(userId);

    const successText = formatSuccess('✅ GIVEAWAY CREATED', [
      ['Status', '✅ Success'],
      ['Channel', channelId],
      ['Type', type.replace(/_/g, ' ').toUpperCase()],
      ['Prize', prize],
      ['Winners', winnersCount.toString()],
      ['Detail', 'Posted to channel']
    ]);

    return bot.editMessageText(successText, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 My Giveaways', callback_data: 'manage_giveaways' }],
          [{ text: '🎉 Create Another', callback_data: 'create_start' }]
        ]
      }
    });

  } catch (err) {
    console.error('Create giveaway error:', err);
    const errorText = formatWarning(
      '❌ ERROR',
      '❌ Failed',
      'Could not create giveaway',
      'Try again later'
    );
    return bot.editMessageText(errorText, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML'
    });
  }
}

// ─── Handle Channel Forward ───────────────────────────

async function handleChannelForward(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const state = getState(userId);

  if (state.state !== 'waiting_channel_forward') return;

  // Check if forwarded from channel
  if (!msg.forward_from_chat || msg.forward_from_chat.type !== 'channel') {
    const text = formatWarning(
      '❌ INVALID FORWARD',
      '❌ Denied',
      'Not a channel message',
      'Forward a message FROM your channel'
    );
    return sendBox(bot, chatId, text);
  }

  const channelId = msg.forward_from_chat.id.toString();
  const title = msg.forward_from_chat.title || '';
  const username = msg.forward_from_chat.username || '';

  // Verify bot is admin
  try {
    const botMember = await bot.getChatMember(channelId, (await bot.getMe()).id);
    if (!botMember || !['creator', 'administrator'].includes(botMember.status)) {
      const text = formatWarning(
        '❌ ADMIN REQUIRED',
        '❌ Denied',
        'Bot is not admin in this channel',
        'Add bot as admin then forward again'
      );
      return sendBox(bot, chatId, text);
    }
  } catch (err) {
    const text = formatWarning(
      '❌ CANNOT VERIFY',
      '❌ Denied',
      'Bot cannot access channel',
      'Add bot to channel first'
    );
    return sendBox(bot, chatId, text);
  }

  await addOwnerChannel(channelId, userId, title, username);

  const text = formatSuccess('✅ CHANNEL ADDED', [
    ['Status', '✅ Success'],
    ['Channel', title || username || channelId],
    ['Detail', 'Channel saved.']
  ]);

  clearState(userId);

  return sendBox(bot, chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎉 Create Giveaway', callback_data: 'create_start' }],
        [{ text: '➕ Add Another', callback_data: 'add_channel' }]
      ]
    }
  });
}

// ─── /manage ──────────────────────────────────────────────

async function handleManage(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const giveaways = await getOwnerGiveaways(userId);

  if (giveaways.length === 0) {
    const text = formatBox('📋 MY GIVEAWAYS', [
      ['Status', 'No active giveaways'],
      ['Action', 'Create one first!']
    ]);
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎉 Create Giveaway', callback_data: 'create_start' }],
          [{ text: '🔙 Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
  }

  const text = formatBox('📋 MY GIVEAWAYS', [
    ['Total', giveaways.length.toString()],
    ['Action', 'Tap to manage']
  ]);

  const keyboard = giveaways.slice(0, 10).map(g => {
    const status = g.status === 'active' ? '🟢' : '🔴';
    return [{ text: `${status} ${g.prize} (${g.type})`, callback_data: `manage_${g.giveawayId}` }];
  });
  keyboard.push([{ text: '🔙 Main Menu', callback_data: 'main_menu' }]);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function handleManageGiveaway(bot, query, giveawayId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const giveaway = await getGiveaway(giveawayId);
  if (!giveaway || giveaway.ownerId !== userId) {
    const text = formatWarning('❌ NOT FOUND', '❌ Denied', 'Giveaway not found', 'Try again');
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML'
    });
  }

  const entries = await getGiveawayEntries(giveawayId);
  const timeLeft = getTimeLeft(giveaway.endsAt);

  const rows = [
    ['Prize', giveaway.prize],
    ['Type', giveaway.type.replace(/_/g, ' ').toUpperCase()],
    ['Status', giveaway.status.toUpperCase()],
    ['Entries', entries.length.toString()],
    ['Winners', giveaway.winnersCount.toString()],
    ['Ends In', timeLeft]
  ];

  const text = formatBox('⚙️ MANAGE GIVEAWAY', rows);

  const keyboard = [];
  if (giveaway.status === 'active') {
    keyboard.push([{ text: '🎲 Draw Winners Now', callback_data: `draw_${giveawayId}` }]);
    keyboard.push([{ text: '🗑️ Cancel Giveaway', callback_data: `cancel_giveaway_${giveawayId}` }]);
  }
  keyboard.push([{ text: '📊 View Entries', callback_data: `entries_${giveawayId}` }]);
  keyboard.push([{ text: '🔙 Back', callback_data: 'manage_giveaways' }]);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ─── /sponsor ────────────────────────────────────────────

async function handleSponsor(bot, query) {
  const chatId = query.message.chat.id;

  const text = formatInfoBox(
    '💎 SPONSOR YOUR CHANNEL',
    [
      '',
      'Feature your channel in EVERY',
      'giveaway worldwide:',
      '',
      '• Force-join required for all users',
      '• Public link in every giveaway post',
      '• Maximum exposure & growth',
      '',
      '💰 PRICING',
      '',
      'Option  │  $10 (Crypto/Bank)',
      'Option  │  150 Telegram ⭐',
      '',
      '📩 DM @' + config.OWNER_USERNAME,
      '   Your slot activates within 24h'
    ]
  );

  const keyboard = {
    inline_keyboard: [
      [{ text: '📩 Contact @' + config.OWNER_USERNAME, url: `https://t.me/${config.OWNER_USERNAME}` }],
      [{ text: '🔙 Main Menu', callback_data: 'main_menu' }]
    ]
  };

  if (query.message.photo) {
    return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
}

// ─── /help ──────────────────────────────────────────────

async function handleHelp(bot, query) {
  const chatId = query.message.chat.id;

  const text = formatInfoBox(
    '❓ HELP & COMMANDS',
    [
      '',
      '/start — Welcome & main menu',
      '/create — Start new giveaway',
      '/manage — Your giveaways',
      '/sponsor — Sponsor info',
      '',
      'FOR CHANNEL OWNERS:',
      '1. Add bot as admin to your channel',
      '2. Forward any channel message to bot',
      '3. Tap 🎉 Create Giveaway',
      '4. Follow the wizard',
      '',
      'FOR PARTICIPANTS:',
      '1. Tap 🎉 Join Giveaway on any post',
      '2. Join all required channels',
      '3. Submit your entry',
      '4. Vote for others!'
    ]
  );

  const keyboard = { inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]] };

  if (query.message.photo) {
    return bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
}

// ─── Main Menu ──────────────────────────────────────────

async function handleMainMenu(bot, query) {
  const chatId = query.message.chat.id;

  const text = formatInfoBox(
    '🎉 WELCOME TO GIVEAWAY BOT',
    [
      '',
      "🤖 I'm here to help channel owners",
      '   host epic giveaways:',
      '',
      '   • Name Contests  • Referral Battles',
      '   • Caption Wars   • Reaction Drops',
      '   • First-to-DM    • Auto-Draws & More!',
      '',
      '👑 Channel owners: Add me as admin',
      '   to your channel then tap below',
      '',
      '💎 Want YOUR channel featured?',
      '   DM ' + config.OWNER_USERNAME + ' — $10 or 150 ⭐',
      '',
      "⚡ Let's make someone win today!"
    ]
  );

  const keyboard = {
    inline_keyboard: [
      [{ text: '🎉 Create Giveaway', callback_data: 'create_start' }],
      [{ text: '📋 My Giveaways', callback_data: 'manage_giveaways' }],
      [{ text: '💎 Sponsor Info', callback_data: 'sponsor_info' }],
      [{ text: '❓ Help', callback_data: 'help' }]
    ]
  };

  // If current message is a photo, send new message instead of editing
  if (query.message.photo) {
    return bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard
    });
  }

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: keyboard
  });
}

// ─── Admin Commands ─────────────────────────────────────

async function handleAdmin(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userId !== config.OWNER_ID) {
    const text = formatWarning('❌ ADMIN ONLY', '❌ Denied', 'You are not the bot owner', 'Nice try!');
    return sendBox(bot, chatId, text);
  }

  const giveaways = await getOwnerGiveaways(userId);
  const activeGiveaways = giveaways.filter(g => g.status === 'active');

  const text = formatBox('👑 ADMIN PANEL', [
    ['Total GW', giveaways.length.toString()],
    ['Active', activeGiveaways.length.toString()],
    ['Status', '✅ Online']
  ]);

  return sendBox(bot, chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 All Giveaways', callback_data: 'admin_giveaways' }],
        [{ text: '💎 Manage Sponsors', callback_data: 'admin_sponsors' }],
        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }]
      ]
    }
  });
}

module.exports = {
  userStates,
  setState,
  getState,
  clearState,
  sendBox,
  buildJoinButtons,
  handleStart,
  handleCreateStart,
  handleSelectChannel,
  handleSelectType,
  handlePrizeInput,
  handleWinnersSelect,
  handleDurationSelect,
  handleConfirmGiveaway,
  handleChannelForward,
  handleManage,
  handleManageGiveaway,
  handleSponsor,
  handleHelp,
  handleMainMenu,
  handleAdmin
};
