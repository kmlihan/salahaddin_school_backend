const mongoose = require('mongoose');
const { MultiLangString } = require('./_shared');

/**
 * One section of the "Test your culture" quiz. Sections are a flat list,
 * managed by admin. Examples: Arabic, Sira, Quran, Fiqh.
 *
 * `icon` is just an emoji shown on the section tile in the picker — keeps
 * the UI lively without needing image uploads. `order` lets the admin
 * arrange the tiles.
 */
const cultureSectionSchema = new mongoose.Schema(
  {
    name: { type: MultiLangString, required: true },
    icon: { type: String, default: '📚' }, // emoji
    color: { type: String, default: '#FEF3C7' }, // tile bg
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

cultureSectionSchema.index({ order: 1 });

module.exports = mongoose.model('CultureSection', cultureSectionSchema);
