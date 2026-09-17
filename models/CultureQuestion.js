const mongoose = require('mongoose');
const { MultiLangString } = require('./_shared');

/**
 * A multiple-choice question for the "Test your culture" feature.
 *
 * `options` is a small array (2–6) of multi-lang strings. `correctIndex`
 * points at the correct entry. We keep this dead simple — no partial
 * credit, no multiple correct answers — because the spec is "every
 * question one mark".
 *
 * `explanation` is shown on the results page next to the right answer.
 * Optional but nice for "did you know"-style quizzes.
 */
const cultureQuestionSchema = new mongoose.Schema(
  {
    section: { type: mongoose.Schema.Types.ObjectId, ref: 'CultureSection', required: true },
    question: { type: MultiLangString, required: true },
    options: {
      type: [{ type: MultiLangString }],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length >= 2 && arr.length <= 6,
        message: 'A question must have 2–6 options',
      },
      required: true,
    },
    correctIndex: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: function (n) { return n < (this.options || []).length; },
        message: 'correctIndex must point to one of the options',
      },
    },
    explanation: { type: MultiLangString, default: () => ({}) },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

cultureQuestionSchema.index({ section: 1 });

module.exports = mongoose.model('CultureQuestion', cultureQuestionSchema);
