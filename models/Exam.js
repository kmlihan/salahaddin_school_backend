const mongoose = require('mongoose');
const { MultiLangString } = require('./_shared');

/**
 * One question in an exam. Supports MCQ, true/false, matching, fill-blanks,
 * ordering, and short-answer. Fields not relevant to the active type are
 * simply ignored.
 *
 *   mcq          -> options[], correctIndices[]
 *   truefalse    -> correctBoolean
 *   matching     -> matchPairs[{ left, right }] (server presents shuffled, scores by pair)
 *   fillblank    -> blanks[{ acceptable: [str] }]   (per-blank acceptable answers, per language)
 *   ordering     -> items[] in correct order; client shuffles
 *   shortanswer  -> acceptableAnswers[] (per language; manual review possible too)
 */
const questionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['mcq', 'truefalse', 'matching', 'fillblank', 'ordering', 'shortanswer'],
      required: true,
    },
    question: { type: MultiLangString, required: true },
    score: { type: Number, default: 1 },

    // MCQ
    options: [{ type: MultiLangString }],
    correctIndices: [{ type: Number }], // supports single or multi-correct

    // True / False
    correctBoolean: { type: Boolean },

    // Matching
    matchPairs: [
      {
        left: { type: MultiLangString },
        right: { type: MultiLangString },
      },
    ],

    // Fill in the blanks: question text contains "___" placeholders;
    // `blanks[i].acceptable` is the list of acceptable values for the i-th blank.
    blanks: [
      {
        acceptable: [{ type: String }], // case-insensitive compare on the server
      },
    ],

    // Ordering: `items` are stored in the correct order.
    items: [{ type: MultiLangString }],

    // Short answer: acceptable answers (also a free-text record is kept for review)
    acceptableAnswers: [{ type: String }],
  },
  { _id: true }
);

const examSchema = new mongoose.Schema(
  {
    title: { type: MultiLangString, required: true },
    section: { type: String, required: true },
    level: { type: String, enum: ['A', 'B', 'C', 'D'], required: true },

    // 'lessons' = covers a subset of lessons in a unit
    // 'unit'    = final exam for a whole unit (passing it unlocks the next unit)
    type: { type: String, enum: ['lessons', 'unit'], required: true },

    // Linked content
    lessons: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' }],
    unit: { type: mongoose.Schema.Types.ObjectId },           // logical unit id, used for unlock
    unitName: { type: MultiLangString, default: () => ({}) },

    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },

    questions: [questionSchema],
    passingGrade: { type: Number, default: 50 }, // percentage
  },
  { timestamps: true }
);

examSchema.index({ level: 1, section: 1 });

module.exports = mongoose.model('Exam', examSchema);
