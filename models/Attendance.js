const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    date: { type: Date, required: true },
    /**
     * Optional hour-of-day slot. null on legacy records (one row per
     * day), 1/2/3 on per-hour records. The parent attendance dashboard
     * treats null as "applies to all 3 hours" so the per-hour breakdown
     * still has something to show.
     */
    hour: { type: Number, enum: [1, 2, 3], default: null },
    status: { type: String, enum: ['present', 'absent', 'late', 'excused'], required: true },
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' },
    note: { type: String, default: '' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId },
    recordedByRole: { type: String, enum: ['admin', 'teacher'] },
  },
  { timestamps: true }
);

attendanceSchema.index({ student: 1, date: -1 });
// When (student, date, hour) collide, the bulk upserter overwrites the
// existing row — that's the intended behaviour for "re-record this hour".
attendanceSchema.index({ student: 1, date: 1, hour: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
