const mongoose = require('mongoose');
const { MultiLangString } = require('./_shared');

/**
 * A note attached to a student. It can be a general note, or scoped to a
 * specific lesson or exam result. Authors can be admin, teacher, or parent.
 * Content supports text + media (image/video URLs) and is multi-language.
 */
const noteSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },

    // Author (polymorphic by role)
    authorRole: { type: String, enum: ['admin', 'teacher', 'parent'], required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    authorName: { type: String, default: '' }, // denormalised for quick display

    // Scope
    scope: { type: String, enum: ['general', 'lesson', 'exam'], default: 'general' },
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
    examResult: { type: mongoose.Schema.Types.ObjectId, ref: 'ExamResult' },

    text: { type: MultiLangString, default: () => ({}) },
    imageUrl: { type: String, default: '' },
    videoUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

noteSchema.index({ student: 1, scope: 1, createdAt: -1 });

module.exports = mongoose.model('Note', noteSchema);
