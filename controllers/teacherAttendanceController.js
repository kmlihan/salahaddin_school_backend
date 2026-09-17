const asyncHandler = require('express-async-handler');
const TeacherAttendance = require('../models/TeacherAttendance');

/* ---------- date helpers ---------- */

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dayRange(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const start = startOfDay(d);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/* ---------- endpoints ---------- */

/**
 * GET /api/teacher-attendance?date=YYYY-MM-DD
 * Returns every teacher-attendance record for the given day. Used to
 * pre-fill the daily attendance UI.
 */
exports.byDate = asyncHandler(async (req, res) => {
  const { date } = req.query;
  if (!date) { res.status(400); throw new Error('date required'); }
  const range = dayRange(date);
  if (!range) { res.status(400); throw new Error('Invalid date'); }

  const records = await TeacherAttendance.find({
    date: { $gte: range.start, $lt: range.end },
  })
    .populate('teacher', 'firstName lastName email photo')
    .sort({ 'teacher.lastName': 1 });

  res.json(records);
});

/**
 * POST /api/teacher-attendance/bulk
 * Body: { date: 'YYYY-MM-DD', records: [{ teacher, hours: [1,2,3], note? }, ...] }
 *
 * Upserts attendance for many teachers for the same day in one call.
 *
 * Past-date guard: same rule as student attendance — admins can record
 * today or future, not retroactively. The frontend mirrors this with
 * `min={today}` on the date input. If you want a different rule (for
 * example "allow correction of yesterday's records"), tweak this guard.
 */
exports.bulkUpsert = asyncHandler(async (req, res) => {
  const { date, records } = req.body || {};
  if (!date || !Array.isArray(records)) {
    res.status(400); throw new Error('date and records[] required');
  }
  const range = dayRange(date);
  if (!range) { res.status(400); throw new Error('Invalid date'); }
  if (range.start < startOfDay(new Date())) {
    res.status(400);
    throw new Error('Cannot record attendance for a past date');
  }

  const ops = [];
  for (const r of records) {
    if (!r || !r.teacher) continue;
    const hours = Array.isArray(r.hours)
      ? r.hours.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
      : [];

    ops.push({
      updateOne: {
        filter: {
          teacher: r.teacher,
          date: { $gte: range.start, $lt: range.end },
        },
        update: {
          $set: {
            hours,
            note: r.note || '',
            date: range.start,
            recordedBy: req.user._id,
          },
          $setOnInsert: { teacher: r.teacher },
        },
        upsert: true,
      },
    });
  }

  if (ops.length === 0) {
    return res.json({ matchedCount: 0, modifiedCount: 0, upsertedCount: 0 });
  }

  const result = await TeacherAttendance.bulkWrite(ops);
  res.json({
    matchedCount:  result.matchedCount  || 0,
    modifiedCount: result.modifiedCount || 0,
    upsertedCount: result.upsertedCount || 0,
  });
});

/**
 * GET /api/teacher-attendance/range?teacher=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns the day-by-day records in the range. Powers the payment
 * generation page: admin picks a teacher + range, the UI fetches this,
 * sums hours, applies a rate, computes the amount, generates a payslip.
 *
 * If `teacher` is omitted: returns all teachers' records (admin overview).
 */
exports.byRange = asyncHandler(async (req, res) => {
  const { teacher, from, to } = req.query;
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
  if (teacher) filter.teacher = teacher;

  const records = await TeacherAttendance.find(filter)
    .populate('teacher', 'firstName lastName email photo hourlyRate')
    .sort({ date: 1 });

  // Convenient summary the frontend would otherwise have to compute.
  let totalHours = 0;
  for (const r of records) totalHours += (r.hours || []).length;

  res.json({ records, totalHours });
});
