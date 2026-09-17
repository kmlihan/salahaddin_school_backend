const mongoose = require('mongoose');

/**
 * One record per (teacher, day). The `hours` array holds the integer
 * hour-numbers the teacher actually worked that day — the spec uses
 * "1st h / 2nd h / 3rd h" but we keep it as a flexible array of integers
 * so a fourth (or fifth) hour can be added later without a migration.
 *
 * Saving for a (teacher, day) that already has a record overwrites it, so
 * the admin can revise without creating duplicates. That's enforced by the
 * bulkUpsert path on the controller.
 */
const teacherAttendanceSchema = new mongoose.Schema(
  {
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    date: { type: Date, required: true },
    hours: {
      type: [Number],
      default: [],
      validate: {
        validator: (arr) => arr.every((n) => Number.isInteger(n) && n >= 1 && n <= 12),
        message: 'hours must be integers between 1 and 12',
      },
    },
    note: { type: String, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

// Quick lookups by date and per-teacher.
teacherAttendanceSchema.index({ date: 1 });
teacherAttendanceSchema.index({ teacher: 1, date: -1 });
// One record per (teacher, day). The bulkWrite uses upsert against this
// pair so the unique index isn't strictly required, but it's cheap insurance.
teacherAttendanceSchema.index({ teacher: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('TeacherAttendance', teacherAttendanceSchema);
