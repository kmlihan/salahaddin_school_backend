const mongoose = require('mongoose');
const { MultiLangString, ContentBlock } = require('./_shared');

const lessonSchema = new mongoose.Schema(
  {
    title: { type: MultiLangString, required: true },
    section: { type: String, required: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit' },
    unitName: { type: MultiLangString, default: () => ({}) },
    order: { type: Number, default: 0 },

    /**
     * One lesson can now belong to multiple levels (e.g. ['B', 'C']).
     * The legacy single-level field is kept for older docs and is treated
     * as a fallback by the controller. New writes go to `levels[]`.
     */
    levels: {
      type: [{ type: String, enum: ['A', 'B', 'C', 'D'] }],
      default: [],
    },
    level: { type: String, enum: ['A', 'B', 'C', 'D'], default: null },

    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    blocks: [ContentBlock],
  },
  { timestamps: true }
);

lessonSchema.index({ levels: 1, section: 1, order: 1 });
lessonSchema.index({ level: 1, section: 1, order: 1 }); // legacy

module.exports = mongoose.model('Lesson', lessonSchema);
