const mongoose = require('mongoose');
const { MultiLangString } = require('./_shared');

/**
 * One calendar entry. Two flavours:
 *
 *   kind: 'lesson'  — admin assigns a teacher to a (date, hour) slot for
 *                     one or more student levels
 *   kind: 'dayOff'  — a free / holiday / vacation day. School is closed
 *                     for the listed levels (empty levels = all levels).
 *                     dayOff entries have no teacher and no hour.
 *
 * Keeping both in the same collection makes the calendar feed simple —
 * one query returns lessons + days off, the UI groups them by date.
 *
 * Unique constraint on lessons: same teacher can't be in two places at
 * once. Enforced by a *partial* unique index that only applies to lesson
 * entries (dayOff entries have no teacher / no hour).
 *
 * Status flow (lessons only):
 *   pending   — admin just created it
 *   approved  — teacher confirmed they'll attend
 *   declined  — teacher said they can't; admin needs to reassign
 */
const calendarEntrySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['lesson', 'dayOff'], default: 'lesson', required: true },
    date: { type: Date, required: true },

    // ---- lesson fields (kind === 'lesson') ----
    hour: {
      type: Number,
      enum: [1, 2, 3],
      required: function () { return this.kind === 'lesson'; },
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: function () { return this.kind === 'lesson'; },
    },
    title: {
      type: MultiLangString,
      required: function () { return this.kind === 'lesson'; },
    },
    status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
    approvalNote: { type: String, default: '' },
    approvedAt:   { type: Date, default: null },

    // ---- dayOff fields (kind === 'dayOff') ----
    label: { type: MultiLangString, default: () => ({}) },
    dayOffKind: {
      type: String,
      enum: ['holiday', 'vacation', 'free'],
      default: 'free',
    },

    // ---- shared ----
    levels: {
      type: [{ type: String, enum: ['A', 'B', 'C', 'D'] }],
      default: [],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

// Lessons only: a teacher can't be double-booked at the same (date, hour).
calendarEntrySchema.index(
  { teacher: 1, date: 1, hour: 1 },
  { unique: true, partialFilterExpression: { kind: 'lesson' } }
);
calendarEntrySchema.index({ date: 1, hour: 1 });

module.exports = mongoose.model('CalendarEntry', calendarEntrySchema);
