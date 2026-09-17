const mongoose = require('mongoose');
const { MultiLangString, ContentBlock } = require('./_shared');

const newsSchema = new mongoose.Schema(
  {
    title: { type: MultiLangString, required: true },
    blocks: [ContentBlock],
    coverImage: { type: String, default: '' },
    published: { type: Boolean, default: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('News', newsSchema);
