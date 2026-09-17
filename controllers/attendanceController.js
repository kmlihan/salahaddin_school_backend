const asyncHandler = require('express-async-handler');
const { childrenScope, childScope } = require('../utils/parentScope');
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');

/** Start-of-day in the server's local timezone. */
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Convert a date string ("2026-05-02") into the [start, end) window for
 * that day. Returns null if the input isn't parseable.
 */
function dayRange(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const start = startOfDay(d);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// POST /api/attendance — single record (kept for back-compat; bulkUpsert
// is preferred).
exports.create = asyncHandler(async (req, res) => {
  const { student, date, status, lesson, note } = req.body;
  if (!student || !date || !status) {
    res.status(400); throw new Error('student, date, status required');
  }
  // Reject past dates here too.
  const range = dayRange(date);
  if (!range) { res.status(400); throw new Error('Invalid date'); }
  if (range.start < startOfDay(new Date())) {
    res.status(400); throw new Error('Cannot record attendance for a past date');
  }
  const rec = await Attendance.create({
    student, date: range.start, status, lesson, note,
    recordedBy: req.user._id,
    recordedByRole: req.role,
  });
  res.status(201).json(rec);
});

/**
 * GET /api/attendance?date=YYYY-MM-DD
 * Returns every attendance record for the given day, with the student
 * populated. Used by the "Record" tab to pre-fill existing entries.
 */
exports.byDate = asyncHandler(async (req, res) => {
  const { date, hour } = req.query;
  if (!date) { res.status(400); throw new Error('date required'); }
  const range = dayRange(date);
  if (!range) { res.status(400); throw new Error('Invalid date'); }

  const filter = { date: { $gte: range.start, $lt: range.end } };
  // Optional hour scoping. The teacher per-hour screen passes hour=1|2|3
  // so it only loads (and later overwrites) that hour's records. When
  // hour is absent the admin day-level view gets everything as before.
  if (hour !== undefined && hour !== '') {
    const h = Number(hour);
    if ([1, 2, 3].includes(h)) filter.hour = h;
  }

  const records = await Attendance.find(filter)
    .populate('student', 'firstName lastName level photo gender')
    .sort({ 'student.lastName': 1 });
  res.json(records);
});

/**
 * GET /api/attendance/range?from=YYYY-MM-DD&to=YYYY-MM-DD&students=id1,id2,...
 *
 * Lists attendance records across a date range, optionally filtered by a
 * comma-separated list of student ids. Used by the "History" tab.
 *
 *   - from/to are both inclusive at day granularity
 *   - if `students` is omitted, every student in scope is returned
 *   - admin/teacher only (route-level)
 */
exports.byDateRange = asyncHandler(async (req, res) => {
  const { from, to, students } = req.query;
  if (!from || !to) {
    res.status(400); throw new Error('from and to required');
  }
  const fromR = dayRange(from);
  const toR = dayRange(to);
  if (!fromR || !toR) { res.status(400); throw new Error('Invalid date'); }
  if (fromR.start > toR.start) {
    res.status(400); throw new Error('"from" must be <= "to"');
  }

  const filter = { date: { $gte: fromR.start, $lt: toR.end } };
  if (students) {
    const ids = String(students).split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length) filter.student = { $in: ids };
  }

  const records = await Attendance.find(filter)
    .populate('student', 'firstName lastName level photo gender email')
    .sort({ date: -1 });
  res.json(records);
});

/**
 * POST /api/attendance/bulk
 * Body: { date: 'YYYY-MM-DD', records: [{ student, status, note? }, ...] }
 *
 * Upserts attendance for many students for the same day in one call.
 * Refuses past dates — frontend should mirror the same rule on the date
 * input's `min` attribute.
 */
exports.bulkUpsert = asyncHandler(async (req, res) => {
  const { date, hour, records } = req.body || {};
  if (!date || !Array.isArray(records)) {
    res.status(400); throw new Error('date and records[] required');
  }
  const range = dayRange(date);
  if (!range) { res.status(400); throw new Error('Invalid date'); }

  // Attendance is recorded AFTER a session happens — usually same day,
  // sometimes the next day if the teacher backfills. So we block the
  // FUTURE (you can't take attendance for a class that hasn't occurred)
  // and allow today + past. (Previously this blocked past dates, which
  // made backfilling impossible.)
  const todayEnd = new Date(startOfDay(new Date()).getTime() + 24 * 60 * 60 * 1000);
  if (range.start >= todayEnd) {
    res.status(400);
    throw new Error('Cannot record attendance for a future date');
  }

  // Optional hour. null = day-level record (admin flow). 1/2/3 = a
  // specific class hour (teacher flow). A day-level row and an hour-1
  // row for the same student+date are intentionally distinct documents,
  // so admin day marking and teacher per-hour marking can coexist.
  let hourVal = null;
  if (hour !== undefined && hour !== null && hour !== '') {
    const h = Number(hour);
    if (![1, 2, 3].includes(h)) {
      res.status(400); throw new Error('hour must be 1, 2, or 3');
    }
    hourVal = h;
  }

  const VALID = new Set(['present', 'absent', 'late', 'excused']);
  const ops = [];

  for (const r of records) {
    if (!r || !r.student) continue;
    if (!VALID.has(r.status)) continue;

    ops.push({
      updateOne: {
        filter: {
          student: r.student,
          date: { $gte: range.start, $lt: range.end },
          // Match the same hour slot so re-recording overwrites rather
          // than duplicating. `hour: null` matches legacy/day-level rows.
          hour: hourVal,
        },
        update: {
          $set: {
            status: r.status,
            note: r.note || '',
            date: range.start,
            hour: hourVal,
            recordedBy: req.user._id,
            recordedByRole: req.role,
          },
          $setOnInsert: { student: r.student },
        },
        upsert: true,
      },
    });
  }

  if (ops.length === 0) return res.json({ matchedCount: 0, modifiedCount: 0, upsertedCount: 0 });

  const result = await Attendance.bulkWrite(ops);
  res.json({
    matchedCount:  result.matchedCount  || 0,
    modifiedCount: result.modifiedCount || 0,
    upsertedCount: result.upsertedCount || 0,
  });
});

// GET /api/attendance/student/:id?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Lists attendance records for one student. Parents can only fetch
// their own children (via childScope). Students can only fetch their
// own. Optional from/to narrows to a date range — required for the
// parent dashboard so it doesn't fetch the entire history every time
// the user switches months.
exports.byStudent = asyncHandler(async (req, res) => {
  const studentId = req.params.id;
  if (req.role === 'student' && String(req.user._id) !== String(studentId)) {
    res.status(403); throw new Error('Forbidden');
  }
  if (req.role === 'parent') {
    const child = await Student.findOne(childScope(studentId, req.user._id));
    if (!child) { res.status(403); throw new Error('Forbidden'); }
  }

  const filter = { student: studentId };
  const { from, to } = req.query;
  if (from || to) {
    filter.date = {};
    if (from) {
      const fr = dayRange(from);
      if (!fr) { res.status(400); throw new Error('Invalid from date'); }
      filter.date.$gte = fr.start;
    }
    if (to) {
      const tr = dayRange(to);
      if (!tr) { res.status(400); throw new Error('Invalid to date'); }
      filter.date.$lt = tr.end;
    }
  }

  const records = await Attendance.find(filter).sort({ date: -1 });
  res.json(records);
});

exports.update = asyncHandler(async (req, res) => {
  const rec = await Attendance.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  if (!rec) { res.status(404); throw new Error('Record not found'); }
  res.json(rec);
});

exports.remove = asyncHandler(async (req, res) => {
  const rec = await Attendance.findByIdAndDelete(req.params.id);
  if (!rec) { res.status(404); throw new Error('Record not found'); }
  res.json({ message: 'Record removed' });
});
