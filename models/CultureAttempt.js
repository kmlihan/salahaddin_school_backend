const mongoose = require('mongoose');

/**
 * One completed culture quiz attempt. Captures the questions actually
 * served (so the same attempt can be re-displayed with the right answers
 * later) and the user's chosen option index per question. -1 for no answer.
 *
 * The taker is either a Parent or a Student. We store both a `userKind`
 * discriminator and a `user` ObjectId so the same collection serves both —
 * simpler than a polymorphic ref since we only need to remember which
 * collection to look in.
 */
const cultureAttemptSchema = new mongoose.Schema(
  {
    userKind: { type: String, enum: ['parent', 'student'], required: true },
    user: { type: mongoose.Schema.Types.ObjectId, required: true },

    section: { type: mongoose.Schema.Types.ObjectId, ref: 'CultureSection', required: true },

    // Order matters — answers[i] is the chosen option for questions[i].
    questions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CultureQuestion' }],
    answers: [{ type: Number, default: -1 }],

    correctCount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { timestamps: true }
);

cultureAttemptSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('CultureAttempt', cultureAttemptSchema);
