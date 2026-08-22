const cron = require('node-cron');
const { Giveaway, Entry } = require('./models');
const { drawWinners, getGiveawayEntries } = require('./services');
const { formatBox, formatInfoBox, getTimeLeft } = require('./utils');
const config = require('./config');

function startJobs(bot) {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const expiredGiveaways = await Giveaway.find({
        status: 'active',
        endsAt: { $lte: now }
      });

      for (const giveaway of expiredGiveaways) {
        console.log(`Auto-drawing giveaway: ${giveaway.giveawayId}`);

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

        // Unpin
        try {
          await bot.unpinChatMessage(giveaway.channelId, giveaway.messageId);
        } catch (e) {}

        console.log(`Auto-draw complete: ${giveaway.giveawayId}`);
      }
    } catch (err) {
      console.error('Auto-draw error:', err);
    }
  });

  console.log('✅ Cron jobs started');
}

function formatWarning(title, access, reason, action) {
  return formatBox(title, [
    ['Access', access],
    ['Reason', reason],
    ['Action', action]
  ]);
}

module.exports = { startJobs };
