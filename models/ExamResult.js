const mongoose = require('mongoose');

/**
 * A submitted exam attempt. Stores the student's raw answers, the per-question
 * computed score, totals, and pass/fail. The shape of `answer` depends on the
 * question type (boolean, number[], string, string[], etc) — the controller
 * grades and shapes them before persisting.
 */
const examResultSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },

    answers: [
      {
        questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
        answer: { type: mongoose.Schema.Types.Mixed },
        scoreEarned: { type: Number, default: 0 },
        scoreMax: { type: Number, default: 0 },
        correct: { type: Boolean, default: false },
        feedback: { type: String, default: '' }, // optional teacher feedback
      },
    ],

    totalScore: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },

    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

examResultSchema.index({ student: 1, exam: 1 });

module.exports = mongoose.model('ExamResult', examResultSchema);
