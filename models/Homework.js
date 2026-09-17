const mongoose = require('mongoose');
const { MultiLangString } = require('./_shared');

/**
 * One prompt inside a writing homework. The teacher writes the partial
 * fragment (e.g. `بـ ـ ـ ـ`) in the multi-language `prompt` field, and a
 * single canonical `answer` string the student is supposed to type. The
 * student's answer is graded with a simple normalised case-insensitive
 * compare on the server (Arabic doesn't have case, but we still trim and
 * collapse whitespace so trailing diacritics don't break a match).
 */
const writingPromptSchema = new mongoose.Schema(
  {
    prompt: { type: MultiLangString, required: true },
    answer: { type: String, required: true, trim: true },
  },
  { _id: false }
);

/**
 * Homework. One document per assignment.
 *
 *   kind = 'writing'           -> uses `prompts[]`
 *   kind = 'recordedReading'   -> student uploads an audio recording
 *   kind = 'bookReading'       -> student reads a physical page; parent
 *                                 leaves a note in the submission
 *
 * `level` scopes the homework to all students at that level. Optionally,
 * `assignedTo` narrows it to a specific subset of students. An empty
 * `assignedTo` means "everyone at this level".
 */
const homeworkSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['writing', 'recordedReading', 'bookReading'],
      required: true,
    },
    title: { type: MultiLangString, required: true },
    instructions: { type: MultiLangString, default: () => ({}) },
    level: { type: String, enum: ['A', 'B', 'C', 'D'], required: true },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
    dueDate: { type: Date, default: null },
    prompts: { type: [writingPromptSchema], default: undefined }, // writing only
  },
  { timestamps: true }
);

homeworkSchema.index({ level: 1, dueDate: 1 });

module.exports = mongoose.model('Homework', homeworkSchema);
