// ─── Telegram Blockquote Formatting ─────────────────────

const WIDTH = 40;

function padCenter(text, width) {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

function padRight(text, width) {
  const pad = Math.max(0, width - text.length);
  return text + ' '.repeat(pad);
}

/**
 * Format a box with title and rows using Telegram blockquote
 * rows = [[label, value], [label, value], ...]
 */
function formatBox(title, rows, options = {}) {
  const width = options.width || WIDTH;
  const lines = [];

  // Title with emoji
  lines.push(`<b>${title}</b>`);
  lines.push('');

  // Rows
  for (const row of rows) {
    let label, value;
    if (Array.isArray(row)) {
      [label, value] = row;
    } else {
      label = row.label || '';
      value = row.value || '';
    }

    const labelWidth = 14;
    const valueWidth = width - labelWidth - 4;

    const valueLines = [];
    if (value.length > valueWidth) {
      const words = value.split(' ');
      let current = '';
      for (const word of words) {
        if ((current + ' ' + word).trim().length > valueWidth) {
          valueLines.push(current.trim());
          current = word;
        } else {
          current = current ? current + ' ' + word : word;
        }
      }
      if (current) valueLines.push(current.trim());
    } else {
      valueLines.push(value);
    }

    valueLines.forEach((vl, i) => {
      if (i === 0) {
        const left = padRight(label, labelWidth);
        lines.push(`<code>${left}</code> │ <code>${vl}</code>`);
      } else {
        const left = padRight('', labelWidth);
        lines.push(`<code>${left}</code> │ <code>${vl}</code>`);
      }
    });
  }

  return '<blockquote expandable>\n' + lines.join('\n') + '\n</blockquote>';
}

/**
 * Simple info box using Telegram blockquote
 */
function formatInfoBox(title, textLines, options = {}) {
  const width = options.width || WIDTH;
  const lines = [];

  lines.push(`<b>${title}</b>`);
  lines.push('');

  for (const text of textLines) {
    const maxLen = width - 2;
    if (text.length > maxLen) {
      const words = text.split(' ');
      let current = '';
      for (const word of words) {
        if ((current + ' ' + word).trim().length > maxLen) {
          lines.push(`<code>${current.trim()}</code>`);
          current = word;
        } else {
          current = current ? current + ' ' + word : word;
        }
      }
      if (current) lines.push(`<code>${current.trim()}</code>`);
    } else {
      lines.push(`<code>${text}</code>`);
    }
  }

  return '<blockquote expandable>\n' + lines.join('\n') + '\n</blockquote>';
}

/**
 * Warning/Error box
 */
function formatWarning(title, access, reason, action) {
  return formatBox(title, [
    ['Access', access],
    ['Reason', reason],
    ['Action', action]
  ]);
}

/**
 * Success box
 */
function formatSuccess(title, rows) {
  return formatBox(title, rows);
}

/**
 * Generate unique IDs
 */
function generateId(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).substr(2, 5).toUpperCase();
}

/**
 * Escape markdown for Telegram (basic)
 */
function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Get time left string
 */
function getTimeLeft(date) {
  const now = new Date();
  const diff = date - now;
  if (diff <= 0) return 'Ended';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

module.exports = {
  formatBox,
  formatInfoBox,
  formatWarning,
  formatSuccess,
  generateId,
  escapeMarkdown,
  getTimeLeft,
  WIDTH
};
