const mongoose = require('mongoose');
const { MultiLangString } = require('./_shared');

/**
 * A student's submission for one homework. There's at most one of these
 * per (homework, student) pair — re-submissions update the same document
 * via upsert.
 *
 * The relevant fields depend on `kind`:
 *
 *   writing         -> answers: [String]   (one per prompt, position-aligned)
 *                      autoScore: Number   (0..100, computed at submit time)
 *
 *   recordedReading -> audioUrl: String    (path returned by /api/upload)
 *
 *   bookReading     -> parentNote: MultiLangString
 *                      parentNoteBy: ObjectId (Parent who wrote it)
 *                      confirmedByParent: Boolean (set when a parent saves
 *                                                  a note — flips the
 *                                                  homework into "done")
 *
 * Teacher feedback and a manual score are available regardless of kind.
 */
const submissionSchema = new mongoose.Schema(
  {
    homework: { type: mongoose.Schema.Types.ObjectId, ref: 'Homework', required: true },
    student:  { type: mongoose.Schema.Types.ObjectId, ref: 'Student',  required: true },
    kind: {
      type: String,
      enum: ['writing', 'recordedReading', 'bookReading'],
      required: true,
    },

    // writing
    answers: [{ type: String }],
    autoScore: { type: Number, default: null },

    // recordedReading
    audioUrl: { type: String, default: '' },

    // bookReading
    parentNote: { type: MultiLangString, default: () => ({}) },
    parentNoteBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent' },
    confirmedByParent: { type: Boolean, default: false },

    // teacher review
    teacherFeedback: { type: MultiLangString, default: () => ({}) },
    teacherScore: { type: Number, default: null },

    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

submissionSchema.index({ homework: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('HomeworkSubmission', submissionSchema);
