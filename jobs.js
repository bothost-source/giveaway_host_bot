const cron = require('node-cron');
const { Giveaway, Entry } = require('./models');
const { drawWinners, getGiveawayEntries } = require('./services');
const { formatBox, formatInfoBox, getTimeLeft } = require('./utils');
const config = require('./config');

// Track which first_to_dm giveaways are collecting DMs
const collectingGiveaways = new Map();

function startJobs(bot) {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      // ─── Handle giveaways that just ended ─────────────────
      const justEnded = await Giveaway.find({
        status: 'active',
        endsAt: { $lte: now }
      });

      for (const giveaway of justEnded) {
        console.log(`Giveaway ended: ${giveaway.giveawayId}`);

        if (giveaway.type === 'first_to_dm') {
          // Post "DM ME NOW" message to channel
          await handleFirstToDmStart(bot, giveaway);
        } else {
          // Normal auto-draw
          await handleNormalDraw(bot, giveaway);
        }
      }

    } catch (err) {
      console.error('Cron error:', err);
    }
  });

  console.log('✅ Cron jobs started');
}

// ─── First to DM: Post "DM ME NOW" ──────────────────────
async function handleFirstToDmStart(bot, giveaway) {
  const me = await bot.getMe();

  // Post the DM challenge to channel
  const challengeText = formatBox(`⏰ ${giveaway.prize.toUpperCase()} — DM CHALLENGE!`, [
    ['Type', 'FIRST TO DM'],
    ['Prize', giveaway.prize],
    ['Winners', giveaway.winnersCount.toString()],
    ['Status', '🟢 LIVE NOW!']
  ]);

  const challengeMsg = await bot.sendMessage(giveaway.channelId, challengeText + 
    `\n\n<b>📩 FIRST ${giveaway.winnersCount} TO DM @${me.username} WIN!</b>\n` +
    `Tap the button below to DM me!`, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: `📩 DM @${me.username}`, url: `https://t.me/${me.username}` }]
      ]
    }
  });

  // Mark as collecting
  collectingGiveaways.set(giveaway.giveawayId, {
    giveaway,
    challengeMsgId: challengeMsg.message_id,
    startedAt: Date.now(),
    winnersPicked: false
  });

  // Set timeout to pick winners after 5 minutes (or host can trigger early)
  setTimeout(async () => {
    await pickFirstToDmWinners(bot, giveaway.giveawayId);
  }, 5 * 60 * 1000); // 5 minutes
}

// ─── Pick First to DM Winners ───────────────────────────
async function pickFirstToDmWinners(bot, giveawayId) {
  const collectData = collectingGiveaways.get(giveawayId);
  if (!collectData || collectData.winnersPicked) return;

  collectData.winnersPicked = true;
  const giveaway = collectData.giveaway;

  // Get entries sorted by dmOrder (who DM'd first)
  const entries = await getGiveawayEntries(giveawayId);
  const sorted = entries.sort((a, b) => a.dmOrder - b.dmOrder);
  const winners = sorted.slice(0, giveaway.winnersCount);

  // Get host info
  let hostUsername = 'the host';
  try {
    const host = await bot.getChat(giveaway.channelId);
    hostUsername = host.username ? `@${host.username}` : 'the host';
  } catch (e) {}

  if (winners.length === 0) {
    // No one DM'd
    const noWinnerText = formatWarning(
      '❌ NO WINNERS',
      "❌ No one DM'd",
      'Nobody sent a DM in time',
      'Better luck next time!'
    );
    await bot.sendMessage(giveaway.channelId, noWinnerText, { parse_mode: 'HTML' });
  } else {
    // Announce winners
    const winnerLines = winners.map((w, i) => {
      const name = w.username ? `@${w.username}` : `User ${w.userId}`;
      return `${i + 1}. ${name} (#${w.dmOrder})`;
    });

    let announceText = formatBox(`🎉 WINNERS — ${giveaway.prize.toUpperCase()}`, [
      ['Type', 'FIRST TO DM'],
      ['Total DM's', entries.length.toString()],
      ['Winners', winners.length.toString()]
    ]);

    announceText += '\n\n🥇 WINNERS (Fastest DM's):\n' + winnerLines.join('\n');
    announceText += `\n\n🎊 DM ${hostUsername} to claim your prize!`;

    await bot.sendMessage(giveaway.channelId, announceText, { parse_mode: 'HTML' });

    // DM winners
    for (const winner of winners) {
      try {
        await bot.sendMessage(winner.userId, 
          `🎉 YOU WON!\n\nPrize: ${giveaway.prize}\nDM ${hostUsername} to claim!`, 
          { parse_mode: 'HTML' }
        );
      } catch (e) {}
    }
  }

  // Update giveaway status
  const winnerData = winners.map(w => ({
    userId: w.userId,
    username: w.username,
    entryId: w.entryId
  }));

  await Giveaway.updateOne(
    { giveawayId },
    { status: 'ended', winners: winnerData }
  );

  collectingGiveaways.delete(giveawayId);
}

// ─── Normal Auto-Draw ───────────────────────────────────
async function handleNormalDraw(bot, giveaway) {
  const winners = await drawWinners(giveaway);
  const entries = await getGiveawayEntries(giveaway.giveawayId);

  if (winners.length > 0) {
    const winnerLines = winners.map((w, i) => {
      const name = w.username ? `@${w.username}` : `User ${w.userId}`;
      return `${i + 1}. ${name}`;
    });

    let announceText = formatBox('🎉 GIVEAWAY ENDED — WINNERS!', [
      ['Giveaway', giveaway.prize],
      ['Type', giveaway.type.replace(/_/g, ' ').toUpperCase()],
      ['Total Entries', entries.length.toString()],
      ['Winners', winners.length.toString()]
    ]);

    announceText += '\n\n🥇 WINNERS:\n' + winnerLines.join('\n');
    announceText += `\n\n🎊 Congratulations! DM host for prize.`;
    announceText += `\n\nPowered by @${config.OWNER_CHANNEL.replace('@', '')}`;

    await bot.sendMessage(giveaway.channelId, announceText, { parse_mode: 'HTML' });
  } else {
    const noWinnerText = formatWarning(
      '❌ GIVEAWAY ENDED',
      '❌ No Winners',
      'No entries were submitted',
      'Better luck next time!'
    );
    await bot.sendMessage(giveaway.channelId, noWinnerText, { parse_mode: 'HTML' });
  }

  try {
    await bot.unpinChatMessage(giveaway.channelId, giveaway.messageId);
  } catch (e) {}
}

function formatWarning(title, access, reason, action) {
  return formatBox(title, [
    ['Access', access],
    ['Reason', reason],
    ['Action', action]
  ]);
}

module.exports = { startJobs, pickFirstToDmWinners, collectingGiveaways };
