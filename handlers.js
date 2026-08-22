const config = require('./config');
const {
  getOrCreateUser, checkMembership, checkAllMemberships,
  createEntry, getEntry, getGiveawayEntries, getUserEntry,
  voteEntry, removeVote, removeAllUserVotes, getLeaderboard,
  deleteEntry, quitGiveaway, drawWinners, cancelGiveaway,
  createReferral, confirmReferral, getReferralCount, getReferralLink,
  handleUserLeftChannel, banUserFromChannel, isUserBanned,
  getGiveaway, getActiveGiveaways, getOwnerChannels
} = require('./services');
const {
  formatBox, formatInfoBox, formatWarning, formatSuccess,
  getTimeLeft, generateId
} = require('./utils');
const {
  userStates, setState, getState, clearState,
  sendBox, buildJoinButtons,
  handleCreateStart, handleSelectChannel, handleSelectType,
  handlePrizeInput, handleWinnersSelect, handleDurationSelect,
  handleConfirmGiveaway, handleChannelForward,
  handleManage, handleManageGiveaway, handleSponsor,
  handleHelp, handleMainMenu
} = require('./commands');

// ─── Callback Query Router ──────────────────────────────

function setupCallbacks(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    try {
      await bot.answerCallbackQuery(query.id);

      // ─── Membership Check ─────────────────────────────
      if (data === 'check_membership_start') {
        const isMember = await checkMembership(bot, userId, config.OWNER_CHANNEL);
        if (isMember) {
          // Re-trigger start
          const msg = query.message;
          msg.from = query.from;
          return require('./commands').handleStart(bot, msg, []);
        } else {
          const text = formatWarning(
            '⚠️ STILL NOT JOINED',
            '❌ Denied',
            'You have not joined yet',
            'Join the channel then tap again'
          );
          return bot.editMessageText(text, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'HTML'
          });
        }
      }

      if (data === 'check_membership') {
        // Generic membership check (used during entry flow)
        const state = getState(userId);
        if (state.data.giveawayId) {
          const giveaway = await getGiveaway(state.data.giveawayId);
          if (giveaway) {
            const { allJoined, missing } = await checkAllMemberships(bot, userId, giveaway);
            if (allJoined) {
              // Proceed to entry
              return promptForEntry(bot, chatId, userId, giveaway);
            } else {
              const text = formatWarning(
                '⚠️ ACCESS WARNING',
                '❌ Denied',
                'Still missing channels',
                'Join all then try again'
              );
              return bot.editMessageText(text, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buildJoinButtons(missing.map(m => m.channel)) }
              });
            }
          }
        }
        return;
      }

      // ─── Navigation ───────────────────────────────────
      if (data === 'main_menu') return handleMainMenu(bot, query);
      if (data === 'cancel') {
        clearState(userId);
        return handleMainMenu(bot, query);
      }
      if (data === 'help') return handleHelp(bot, query);
      if (data === 'sponsor_info') return handleSponsor(bot, query);

      // ─── Create Flow ──────────────────────────────────
      if (data === 'create_start') return handleCreateStart(bot, query);
      if (data === 'add_channel') {
        setState(userId, 'waiting_channel_forward', {});
        const text = formatBox('➕ ADD CHANNEL', [
          ['Action', 'Forward any message'],
          ['', 'from your channel here']
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

      if (data.startsWith('select_channel_')) {
        const channelId = data.replace('select_channel_', '');
        return handleSelectChannel(bot, query, channelId);
      }

      if (data.startsWith('type_')) {
        const type = data.replace('type_', '');
        return handleSelectType(bot, query, type);
      }

      if (data.startsWith('winners_')) {
        const count = data.replace('winners_', '');
        return handleWinnersSelect(bot, query, count);
      }

      if (data.startsWith('duration_')) {
        const duration = data.replace('duration_', '');
        return handleDurationSelect(bot, query, duration);
      }

      if (data === 'confirm_giveaway') {
        return handleConfirmGiveaway(bot, query);
      }

      // ─── Manage ───────────────────────────────────────
      if (data === 'manage_giveaways') return handleManage(bot, query);
      if (data.startsWith('manage_')) {
        const giveawayId = data.replace('manage_', '');
        return handleManageGiveaway(bot, query, giveawayId);
      }

      // ─── Join Giveaway ────────────────────────────────
      if (data.startsWith('join_')) {
        const giveawayId = data.replace('join_', '');
        return handleJoinGiveaway(bot, query, giveawayId);
      }

      // ─── Vote ─────────────────────────────────────────
      if (data.startsWith('vote_')) {
        const entryId = data.replace('vote_', '');
        return handleVote(bot, query, entryId);
      }

      // ─── Leaderboard ──────────────────────────────────
      if (data.startsWith('leaderboard_')) {
        const giveawayId = data.replace('leaderboard_', '');
        return handleLeaderboard(bot, query, giveawayId);
      }

      // ─── Draw Winners ─────────────────────────────────
      if (data.startsWith('draw_')) {
        const giveawayId = data.replace('draw_', '');
        return handleDrawWinners(bot, query, giveawayId);
      }

      // ─── Cancel Giveaway ──────────────────────────────
      if (data.startsWith('cancel_giveaway_')) {
        const giveawayId = data.replace('cancel_giveaway_', '');
        return handleCancelGiveaway(bot, query, giveawayId);
      }

      // ─── View Entries ─────────────────────────────────
      if (data.startsWith('entries_')) {
        const giveawayId = data.replace('entries_', '');
        return handleViewEntries(bot, query, giveawayId);
      }

      // ─── Delete Entry (Owner) ───────────────────────
      if (data.startsWith('delete_entry_')) {
        const entryId = data.replace('delete_entry_', '');
        return handleDeleteEntry(bot, query, entryId);
      }

      // ─── Ban User (Owner) ─────────────────────────────
      if (data.startsWith('ban_user_')) {
        const parts = data.replace('ban_user_', '').split('_');
        const userToBan = parseInt(parts[0]);
        const channelId = parts[1];
        return handleBanUser(bot, query, userToBan, channelId);
      }

      // ─── Quit Giveaway ────────────────────────────────
      if (data.startsWith('quit_')) {
        const giveawayId = data.replace('quit_', '');
        return handleQuitGiveaway(bot, query, giveawayId);
      }

      // ─── Referral Link ────────────────────────────────
      if (data.startsWith('reflink_')) {
        const giveawayId = data.replace('reflink_', '');
        return handleReferralLink(bot, query, giveawayId);
      }

    } catch (err) {
      console.error('Callback error:', err);
    }
  });
}

// ─── Join Giveaway ──────────────────────────────────────

async function handleJoinGiveaway(bot, query, giveawayId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const username = query.from.username || '';

  const giveaway = await getGiveaway(giveawayId);
  if (!giveaway || giveaway.status !== 'active') {
    return bot.answerCallbackQuery(query.id, { text: 'Giveaway not active!', show_alert: true });
  }

  // Check if banned
  const banned = await isUserBanned(userId, giveaway.channelId);
  if (banned) {
    return bot.answerCallbackQuery(query.id, { text: 'You are banned from this channel!', show_alert: true });
  }

  // Check if already entered
  const existing = await getUserEntry(giveawayId, userId);
  if (existing) {
    return bot.answerCallbackQuery(query.id, { text: 'You already joined this giveaway!', show_alert: true });
  }

  // Check memberships
  const { allJoined, missing } = await checkAllMemberships(bot, userId, giveaway);

  if (!allJoined) {
    // Send DM with force-join gate
    const text = formatWarning(
      '⚠️ ACCESS WARNING',
      '❌ Denied',
      'Must join channels first',
      'Join all then try again'
    );

    setState(userId, 'waiting_membership', { giveawayId });

    await bot.sendMessage(userId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buildJoinButtons(missing.map(m => m.channel))
      }
    });

    return bot.answerCallbackQuery(query.id, { text: 'Check your DMs!' });
  }

  // Confirm any pending referral
  await confirmReferral(giveawayId, userId);

  // Prompt for entry based on type
  setState(userId, 'waiting_entry', { giveawayId });

  let promptText = '';
  if (giveaway.type === 'name_vote') {
    promptText = formatBox('📝 SUBMIT ENTRY', [
      ['Giveaway', giveaway.prize],
      ['Type', 'NAME CONTEST'],
      ['Action', 'Send your name!']
    ]);
  } else if (giveaway.type === 'caption') {
    promptText = formatBox('📝 SUBMIT ENTRY', [
      ['Giveaway', giveaway.prize],
      ['Type', 'CAPTION CONTEST'],
      ['Action', 'Send your caption!']
    ]);
  } else if (giveaway.type === 'referral') {
    const me = await bot.getMe();
    const link = await getReferralLink(giveawayId, userId, me.username);
    const count = await getReferralCount(giveawayId, userId);

    promptText = formatBox('📢 REFERRAL GIVEAWAY', [
      ['Giveaway', giveaway.prize],
      ['Your Refs', count.toString()],
      ['Action', 'Share your link!']
    ]);

    await bot.sendMessage(userId, promptText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Copy Referral Link', url: link }],
          [{ text: '🔙 Back', callback_data: 'main_menu' }]
        ]
      }
    });

    return bot.answerCallbackQuery(query.id, { text: 'Check your DMs!' });
  } else {
    // Random, reaction, comment, share, first_to_dm, auto_draw
    // These don't need DM entry, just join
    const entry = await createEntry(giveawayId, userId, username, 'Joined');

    if (entry.success) {
      const successText = formatSuccess('✅ ENTRY SUBMITTED', [
        ['Status', '✅ Success'],
        ['Entry #', `#${entry.entry.entryNumber}`],
        ['Giveaway', giveaway.prize],
        ['Detail', 'You are in! Good luck!']
      ]);

      await bot.sendMessage(userId, successText, { parse_mode: 'HTML' });

      // Update giveaway post with new entry count
      await updateGiveawayPost(bot, giveaway);

      return bot.answerCallbackQuery(query.id, { text: 'You joined successfully!' });
    } else {
      return bot.answerCallbackQuery(query.id, { text: entry.error, show_alert: true });
    }
  }

  await bot.sendMessage(userId, promptText, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Cancel', callback_data: 'cancel' }]
      ]
    }
  });

  return bot.answerCallbackQuery(query.id, { text: 'Check your DMs!' });
}

async function promptForEntry(bot, chatId, userId, giveaway) {
  setState(userId, 'waiting_entry', { giveawayId: giveaway.giveawayId });

  let promptText = '';
  if (giveaway.type === 'name_vote') {
    promptText = formatBox('📝 SUBMIT ENTRY', [
      ['Giveaway', giveaway.prize],
      ['Type', 'NAME CONTEST'],
      ['Action', 'Send your name!']
    ]);
  } else if (giveaway.type === 'caption') {
    promptText = formatBox('📝 SUBMIT ENTRY', [
      ['Giveaway', giveaway.prize],
      ['Type', 'CAPTION CONTEST'],
      ['Action', 'Send your caption!']
    ]);
  }

  return bot.sendMessage(chatId, promptText, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Cancel', callback_data: 'cancel' }]
      ]
    }
  });
}

// ─── Handle Text Messages ─────────────────────────────────

function setupMessages(bot) {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || '';

    // Ignore channel posts
    if (msg.chat.type !== 'private') return;

    // Ignore commands
    if (msg.text && msg.text.startsWith('/')) return;

    const state = getState(userId);

    // ─── Prize Input ──────────────────────────────────
    if (state.state === 'waiting_prize') {
      return handlePrizeInput(bot, msg);
    }

    // ─── Channel Forward ──────────────────────────────
    if (state.state === 'waiting_channel_forward') {
      return handleChannelForward(bot, msg);
    }

    // ─── Entry Submission ─────────────────────────────
    if (state.state === 'waiting_entry') {
      const giveawayId = state.data.giveawayId;
      const giveaway = await getGiveaway(giveawayId);

      if (!giveaway || giveaway.status !== 'active') {
        clearState(userId);
        const text = formatWarning('❌ ENDED', '❌ Denied', 'Giveaway ended', 'Try another one');
        return sendBox(bot, chatId, text);
      }

      // Re-check membership
      const { allJoined } = await checkAllMemberships(bot, userId, giveaway);
      if (!allJoined) {
        const text = formatWarning('❌ MEMBERSHIP', '❌ Denied', 'You left a channel', 'Rejoin to enter');
        return sendBox(bot, chatId, text);
      }

      const data = msg.text ? msg.text.trim() : (msg.caption || 'No text');

      if (!data || data.length < 1) {
        const text = formatWarning('❌ EMPTY', '❌ Denied', 'Entry cannot be empty', 'Send something valid');
        return sendBox(bot, chatId, text);
      }

      const result = await createEntry(giveawayId, userId, username, data);

      if (result.success) {
        clearState(userId);

        const successText = formatSuccess('✅ ENTRY SUBMITTED', [
          ['Status', '✅ Success'],
          ['Entry #', `#${result.entry.entryNumber}`],
          ['Name', data.length > 20 ? data.slice(0, 20) + '...' : data],
          ['Detail', 'Posted to channel!']
        ]);

        await sendBox(bot, chatId, successText);

        // Post entry to channel
        await postEntryToChannel(bot, giveaway, result.entry, username);

        // Update giveaway post
        await updateGiveawayPost(bot, giveaway);

      } else {
        const text = formatWarning('❌ ERROR', '❌ Denied', result.error, 'Try again');
        return sendBox(bot, chatId, text);
      }
    }
  });
}

// ─── Post Entry to Channel ────────────────────────────────

async function postEntryToChannel(bot, giveaway, entry, username) {
  const displayName = username ? `@${username}` : `User ${entry.userId}`;

  let text = formatBox(`ENTRY #${entry.entryNumber}`, [
    ['By', displayName],
    ['Name', entry.data.length > 25 ? entry.data.slice(0, 25) + '...' : entry.data],
    ['Votes', '0']
  ]);

  // For vote-based giveaways, add vote button
  const keyboard = [];
  if (giveaway.type === 'name_vote' || giveaway.type === 'caption') {
    keyboard.push([{ text: '👍 Vote', callback_data: `vote_${entry.entryId}` }]);
  }

  try {
    await bot.sendMessage(giveaway.channelId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined
    });
  } catch (err) {
    console.error('Post entry error:', err);
  }
}

// ─── Update Giveaway Post ───────────────────────────────

async function updateGiveawayPost(bot, giveaway) {
  if (!giveaway.messageId) return;

  try {
    const entries = await getGiveawayEntries(giveaway.giveawayId);
    const requiredChannels = [config.OWNER_CHANNEL, ...(giveaway.sponsorChannels || [])].filter(Boolean);
    const channelList = requiredChannels.map(c => {
      const uname = c.startsWith('@') ? c : '@' + c.replace('-100', '');
      return `• ${uname}`;
    });

    let text = formatBox(`🎉 GIVEAWAY: ${giveaway.prize.toUpperCase()}`, [
      ['Type', giveaway.type.replace(/_/g, ' ').toUpperCase()],
      ['Prize', giveaway.prize],
      ['Winners', giveaway.winnersCount.toString()],
      ['Entries', entries.length.toString()],
      ['Ends In', getTimeLeft(giveaway.endsAt)]
    ]);

    text += '\n' + formatInfoBox('✅ MUST JOIN', [
      `• @${giveaway.channelId.replace('-100', '')} (host)`,
      ...channelList
    ], { width: 35 });

    text += '\n\n📝 Tap below to enter!';

    await bot.editMessageText(text, {
      chat_id: giveaway.channelId,
      message_id: giveaway.messageId,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎉 Join Giveaway', callback_data: `join_${giveaway.giveawayId}` }],
          [{ text: '📊 Live Results', callback_data: `leaderboard_${giveaway.giveawayId}` }]
        ]
      }
    });
  } catch (err) {
    console.log('Update post error (expected if too old):', err.message);
  }
}

// ─── Vote Handler ───────────────────────────────────────

async function handleVote(bot, query, entryId) {
  const userId = query.from.id;
  const entry = await getEntry(entryId);

  if (!entry) {
    return bot.answerCallbackQuery(query.id, { text: 'Entry not found!', show_alert: true });
  }

  const giveaway = await getGiveaway(entry.giveawayId);
  if (!giveaway || giveaway.status !== 'active') {
    return bot.answerCallbackQuery(query.id, { text: 'Giveaway ended!', show_alert: true });
  }

  // Can't vote for yourself
  if (entry.userId === userId) {
    return bot.answerCallbackQuery(query.id, { text: 'You cannot vote for yourself!', show_alert: true });
  }

  // Check membership
  const { allJoined } = await checkAllMemberships(bot, userId, giveaway);
  if (!allJoined) {
    return bot.answerCallbackQuery(query.id, { text: 'Join all required channels first!', show_alert: true });
  }

  // Check if banned
  const banned = await isUserBanned(userId, giveaway.channelId);
  if (banned) {
    return bot.answerCallbackQuery(query.id, { text: 'You are banned!', show_alert: true });
  }

  const result = await voteEntry(giveaway.giveawayId, entryId, userId);

  if (result.success) {
    // Update entry message with new vote count
    try {
      const displayName = entry.username ? `@${entry.username}` : `User ${entry.userId}`;
      const text = formatBox(`ENTRY #${entry.entryNumber}`, [
        ['By', displayName],
        ['Name', entry.data.length > 25 ? entry.data.slice(0, 25) + '...' : entry.data],
        ['Votes', result.entry.votesCount.toString()]
      ]);

      await bot.editMessageText(text, {
        chat_id: giveaway.channelId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '👍 Vote', callback_data: `vote_${entryId}` }]]
        }
      });
    } catch (err) {
      console.log('Edit vote error:', err.message);
    }

    return bot.answerCallbackQuery(query.id, { text: `Voted! Total: ${result.entry.votesCount}` });
  } else if (result.error === 'already_voted') {
    return bot.answerCallbackQuery(query.id, { text: 'You already voted!', show_alert: true });
  }
}

// ─── Leaderboard ──────────────────────────────────────────

async function handleLeaderboard(bot, query, giveawayId) {
  const chatId = query.message.chat.id;
  const giveaway = await getGiveaway(giveawayId);

  if (!giveaway) {
    return bot.answerCallbackQuery(query.id, { text: 'Giveaway not found!', show_alert: true });
  }

  const entries = await getLeaderboard(giveawayId, 10);
  const timeLeft = getTimeLeft(giveaway.endsAt);

  const rows = entries.map((e, i) => {
    const name = e.data.length > 15 ? e.data.slice(0, 15) + '...' : e.data;
    return [`#${i + 1} ${name}`, `${e.votesCount} votes`];
  });

  if (rows.length === 0) {
    rows.push(['No entries yet', 'Be the first!']);
  }

  const text = formatBox(`📊 LEADERBOARD — ${giveaway.prize.toUpperCase()}`, [
    ['Ends In', timeLeft],
    ['Total', (await getGiveawayEntries(giveawayId)).length.toString()],
    ...rows
  ]);

  // If in channel, send new message. If in DM, edit.
  if (query.message.chat.type === 'channel') {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎉 Join Giveaway', callback_data: `join_${giveawayId}` }]
        ]
      }
    });
  } else {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎉 Join Giveaway', callback_data: `join_${giveawayId}` }],
          [{ text: '🔙 Back', callback_data: 'main_menu' }]
        ]
      }
    });
  }
}

// ─── Draw Winners ───────────────────────────────────────

async function handleDrawWinners(bot, query, giveawayId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const giveaway = await getGiveaway(giveawayId);
  if (!giveaway || giveaway.ownerId !== userId) {
    return bot.answerCallbackQuery(query.id, { text: 'Not authorized!', show_alert: true });
  }

  if (giveaway.status !== 'active') {
    return bot.answerCallbackQuery(query.id, { text: 'Giveaway not active!', show_alert: true });
  }

  const processingText = formatBox('⚡ PROCESS EXECUTING', [
    ['Target', giveaway.prize],
    ['Status', 'Processing...'],
    ['Detail', 'Selecting winners...']
  ]);

  await bot.editMessageText(processingText, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML'
  });

  const winners = await drawWinners(giveaway);

  if (winners.length === 0) {
    const text = formatWarning('❌ NO ENTRIES', '❌ Failed', 'No entries to draw from', 'Wait for entries');
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML'
    });
  }

  // Build winner announcement
  const winnerLines = winners.map((w, i) => {
    const name = w.username ? `@${w.username}` : `User ${w.userId}`;
    return `${i + 1}. ${name}`;
  });

  const entries = await getGiveawayEntries(giveawayId);

  let announceText = formatBox('🎉 GIVEAWAY ENDED — WINNERS!', [
    ['Giveaway', giveaway.prize],
    ['Type', giveaway.type.replace(/_/g, ' ').toUpperCase()],
    ['Total Entries', entries.length.toString()],
    ['Winners', winners.length.toString()]
  ]);

  announceText += '\n\n🥇 WINNERS:\n' + winnerLines.join('\n');
  announceText += `\n\n🎊 Congratulations! DM host for prize.`;
  announceText += `\n\nPowered by @${config.OWNER_CHANNEL.replace('@', '')}`;

  // Post to channel
  await bot.sendMessage(giveaway.channelId, announceText, { parse_mode: 'HTML' });

  // Update manage view
  const successText = formatSuccess('✅ WINNERS DRAWN', [
    ['Status', '✅ Success'],
    ['Giveaway', giveaway.prize],
    ['Winners', winners.length.toString()],
    ['Detail', 'Announced in channel']
  ]);

  await bot.editMessageText(successText, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 My Giveaways', callback_data: 'manage_giveaways' }]
      ]
    }
  });

  // Unpin the giveaway message
  try {
    await bot.unpinChatMessage(giveaway.channelId, giveaway.messageId);
  } catch (e) {}
}

// ─── Cancel Giveaway ──────────────────────────────────────

async function handleCancelGiveaway(bot, query, giveawayId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const giveaway = await getGiveaway(giveawayId);
  if (!giveaway || giveaway.ownerId !== userId) {
    return bot.answerCallbackQuery(query.id, { text: 'Not authorized!', show_alert: true });
  }

  await cancelGiveaway(giveawayId);

  // Post cancellation to channel
  const cancelText = formatWarning(
    '❌ GIVEAWAY CANCELLED',
    '❌ Cancelled',
    'Host cancelled the giveaway',
    'No winners will be drawn'
  );

  await bot.sendMessage(giveaway.channelId, cancelText, { parse_mode: 'HTML' });

  const text = formatSuccess('✅ CANCELLED', [
    ['Status', '✅ Cancelled'],
    ['Giveaway', giveaway.prize],
    ['Detail', 'Posted to channel']
  ]);

  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 My Giveaways', callback_data: 'manage_giveaways' }]
      ]
    }
  });

  // Unpin
  try {
    await bot.unpinChatMessage(giveaway.channelId, giveaway.messageId);
  } catch (e) {}
}

// ─── View Entries ───────────────────────────────────────

async function handleViewEntries(bot, query, giveawayId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const giveaway = await getGiveaway(giveawayId);
  if (!giveaway || giveaway.ownerId !== userId) {
    return bot.answerCallbackQuery(query.id, { text: 'Not authorized!', show_alert: true });
  }

  const entries = await getGiveawayEntries(giveawayId);

  if (entries.length === 0) {
    const text = formatBox('📋 ENTRIES', [
      ['Total', '0'],
      ['Status', 'No entries yet']
    ]);
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: `manage_${giveawayId}` }]]
      }
    });
  }

  // Show first 5 entries with delete/ban buttons
  const text = formatBox('📋 ENTRIES', [
    ['Total', entries.length.toString()],
    ['Showing', `First ${Math.min(5, entries.length)}`]
  ]);

  const keyboard = entries.slice(0, 5).map(e => {
    const name = e.data.length > 15 ? e.data.slice(0, 15) + '...' : e.data;
    return [{ text: `#${e.entryNumber} ${name} (${e.votesCount}👍)`, callback_data: `entry_detail_${e.entryId}` }];
  });
  keyboard.push([{ text: '🔙 Back', callback_data: `manage_${giveawayId}` }]);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ─── Delete Entry ───────────────────────────────────────

async function handleDeleteEntry(bot, query, entryId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const entry = await getEntry(entryId);
  if (!entry) {
    return bot.answerCallbackQuery(query.id, { text: 'Entry not found!', show_alert: true });
  }

  const giveaway = await getGiveaway(entry.giveawayId);
  if (!giveaway || giveaway.ownerId !== userId) {
    return bot.answerCallbackQuery(query.id, { text: 'Not authorized!', show_alert: true });
  }

  await deleteEntry(entryId);

  // Update post
  await updateGiveawayPost(bot, giveaway);

  const text = formatSuccess('✅ ENTRY DELETED', [
    ['Status', '✅ Success'],
    ['Entry #', `#${entry.entryNumber}`],
    ['Detail', 'Removed from giveaway']
  ]);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔙 Back', callback_data: `entries_${giveaway.giveawayId}` }]
      ]
    }
  });
}

// ─── Ban User ───────────────────────────────────────────

async function handleBanUser(bot, query, userToBan, channelId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  // Verify ownership
  const channels = await getOwnerChannels(userId);
  if (!channels.some(c => c.channelId === channelId) && userId !== config.OWNER_ID) {
    return bot.answerCallbackQuery(query.id, { text: 'Not authorized!', show_alert: true });
  }

  await banUserFromChannel(userToBan, channelId);

  const text = formatSuccess('✅ USER BANNED', [
    ['Status', '✅ Success'],
    ['User ID', userToBan.toString()],
    ['Channel', channelId],
    ['Detail', 'Banned from future giveaways']
  ]);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML'
  });
}

// ─── Quit Giveaway ──────────────────────────────────────

async function handleQuitGiveaway(bot, query, giveawayId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const entry = await quitGiveaway(giveawayId, userId);

  if (entry) {
    const text = formatSuccess('✅ QUIT SUCCESS', [
      ['Status', '✅ Success'],
      ['Entry #', `#${entry.entryNumber}`],
      ['Detail', 'Your entry has been removed']
    ]);

    // Update giveaway post
    const giveaway = await getGiveaway(giveawayId);
    if (giveaway) await updateGiveawayPost(bot, giveaway);

    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
      }
    });
  } else {
    const text = formatWarning('❌ NOT FOUND', '❌ Denied', 'No active entry found', 'You may have already quit');
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'HTML'
    });
  }
}

// ─── Referral Link ──────────────────────────────────────

async function handleReferralLink(bot, query, giveawayId) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  const me = await bot.getMe();
  const link = await getReferralLink(giveawayId, userId, me.username);
  const count = await getReferralCount(giveawayId, userId);

  const text = formatBox('📢 YOUR REFERRAL LINK', [
    ['Link', link],
    ['Confirmed', count.toString()],
    ['Action', 'Share with friends!']
  ]);

  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: query.message.message_id,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Copy Link', url: link }],
        [{ text: '🔙 Back', callback_data: 'main_menu' }]
      ]
    }
  });
}

// ─── Chat Member Updates (Leave Detection) ──────────────

function setupChatMember(bot) {
  bot.on('chat_member', async (msg) => {
    const userId = msg.new_chat_member?.user?.id;
    const chatId = msg.chat.id.toString();
    const oldStatus = msg.old_chat_member?.status;
    const newStatus = msg.new_chat_member?.status;

    // User left or was kicked
    if (['member', 'administrator', 'creator'].includes(oldStatus) && 
        ['left', 'kicked'].includes(newStatus)) {
      await handleUserLeftChannel(userId, chatId);
    }
  });

  // Also handle left_chat_member for backward compatibility
  bot.on('left_chat_member', async (msg) => {
    const userId = msg.left_chat_member.id;
    const chatId = msg.chat.id.toString();
    await handleUserLeftChannel(userId, chatId);
  });
}

module.exports = {
  setupCallbacks,
  setupMessages,
  setupChatMember,
  updateGiveawayPost
};
