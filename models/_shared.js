const { Schema } = require('mongoose');

const MultiLangString = new Schema(
  {
    en: { type: String, default: '' },
    ar: { type: String, default: '' },
    nl: { type: String, default: '' },
  },
  { _id: false }
);

const IconEntry = new Schema(
  {
    kind: { type: String, enum: ['boy', 'girl', 'man'], required: true },
    audioUrl: { type: String, default: '' },
    label: { type: MultiLangString, default: () => ({}) },
  },
  { _id: false }
);

/**
 * Flexible content block. Used by Lesson and News.
 *
 *   text           { content }
 *   textAudio      { content, backgroundColor, audioUrl }       NEW
 *   image          { url, size }
 *   video          { url, size }
 *   imageAudio     { url, audioUrl, size }
 *   imageWithIcons { url, icons[], size }
 *
 * `textAudio` is for the Arabic-textbook-style coloured tiles: a piece of
 * text on a coloured background, optionally with a tap-to-play sound.
 * Use `perRow` to set how many tiles share a row (3 or 4 for a grid like
 * the reference page).
 *
 * `backgroundColor` is also accepted on plain `text` blocks for callouts
 * etc. — it's an ordinary CSS hex string, e.g. '#FEF3C7'.
 */
const ContentBlock = new Schema(
  {
    type: {
      type: String,
      enum: ['text', 'textAudio', 'image', 'video', 'imageAudio', 'imageWithIcons'],
      required: true,
    },
    order: { type: Number, default: 0 },
    size: { type: String, enum: ['25', '50', '75', '100'], default: '100' },
    perRow: { type: Number, enum: [1, 2, 3, 4, 6], default: null },
    // text / textAudio
    content: { type: MultiLangString, default: () => ({}) },
    backgroundColor: { type: String, default: '' }, // hex like '#FEF3C7'
    // media + textAudio
    url: { type: String, default: '' },
    audioUrl: { type: String, default: '' },
    // imageWithIcons
    icons: { type: [IconEntry], default: undefined },
    caption: { type: MultiLangString, default: () => ({}) },
  },
  { _id: true }
);

module.exports = { MultiLangString, ContentBlock };
