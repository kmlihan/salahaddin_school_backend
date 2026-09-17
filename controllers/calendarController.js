const asyncHandler = require('express-async-handler');
const { childrenScope, childScope } = require('../utils/parentScope');
const CalendarEntry = require('../models/CalendarEntry');
const Student = require('../models/Student');

/* ---------- date helpers ---------- */

/**
 * Parse a 'YYYY-MM-DD' (or any ISO date string) into a UTC-midnight Date.
 *
 * IMPORTANT: we deliberately use UTC throughout. Earlier this used
 * `getFullYear/Month/Date` (local) which on a UTC+2 server like Belgium
 * silently shifted dates back by one day:
 *   input  '2026-05-10'  →  new Date → 2026-05-10T00:00:00Z
 *   local getDate → 10, BUT new Date(y, m, d) builds local midnight =
 *     2026-05-10T00:00:00+02:00 → stored as 2026-05-09T22:00:00Z
 * which then displayed as "9 May" everywhere on the client.
 *
 * Storing UTC midnight makes the day independent of server timezone, and
 * the client uses `timeZone: 'UTC'` when formatting day labels so the
 * display stays consistent.
 */
function dayParse(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function nextDayUTC(d) {
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

/* ============================================================ list */

/**
 * GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Visibility:
 *   admin   — everything
 *   teacher — own lesson assignments + ALL day-off entries (so they know
 *             when school is closed)
 *   student — lessons that include their level + day-offs that include
 *             their level (or have empty levels = applies to everyone);
 *             redacted to title/date/hour/levels for lessons
 *   parent  — same as student but for any of their children's levels
 */
exports.list = asyncHandler(async (req, res) => {
  const filter = {};

  // Optional date range
  const from = dayParse(req.query.from);
  const to   = dayParse(req.query.to);
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = from;
    if (to)   filter.date.$lt  = nextDayUTC(to);
  }

  // Per-role scoping. Day-off entries with empty levels apply to everyone,
  // so we $or them in for students/parents.
  if (req.role === 'teacher') {
    // Teacher: own lessons + all day-offs (no level filter on day-offs since
    // they're school-wide info; if it only applies to one level, the
    // teacher still benefits from knowing).
    filter.$or = [
      { kind: 'lesson', teacher: req.user._id },
      { kind: 'dayOff' },
    ];
  } else if (req.role === 'student') {
    filter.$or = [
      { kind: 'lesson', levels: req.user.level },
      { kind: 'dayOff', $or: [{ levels: req.user.level }, { levels: { $size: 0 } }] },
    ];
  } else if (req.role === 'parent') {
    const children = await Student.find(childrenScope(req.user._id)).select('level');
    const levels = [...new Set(children.map((c) => c.level).filter(Boolean))];
    if (levels.length === 0) return res.json([]);
    filter.$or = [
      { kind: 'lesson', levels: { $in: levels } },
      { kind: 'dayOff', $or: [{ levels: { $in: levels } }, { levels: { $size: 0 } }] },
    ];
  }

  let q = CalendarEntry.find(filter).sort({ date: 1, hour: 1 });
  // Only admin and teacher get teacher info populated (parent/student
  // don't see who's teaching).
  if (req.role !== 'student' && req.role !== 'parent') {
    q = q.populate('teacher', 'firstName lastName email');
  }
  const items = await q;

  // Redact lesson rows for parent/student. Day-off entries are already
  // public information so we leave them alone.
  if (req.role === 'student' || req.role === 'parent') {
    return res.json(items.map((it) => {
      if (it.kind === 'lesson') {
        return {
          _id:    it._id,
          kind:   it.kind,
          date:   it.date,
          hour:   it.hour,
          title:  it.title,
          levels: it.levels,
        };
      }
      // dayOff — return as-is (label, kind, levels)
      return {
        _id:        it._id,
        kind:       it.kind,
        date:       it.date,
        label:      it.label,
        dayOffKind: it.dayOffKind,
        levels:     it.levels,
      };
    }));
  }

  res.json(items);
});

/* ============================================================ create */

// POST /api/calendar   (admin)
exports.create = asyncHandler(async (req, res) => {
  const { kind = 'lesson', date, levels } = req.body || {};
  if (!date) { res.status(400); throw new Error('date is required'); }
  const day = dayParse(date);
  if (!day) { res.status(400); throw new Error('Invalid date'); }

  if (kind === 'dayOff') {
    const { label, dayOffKind = 'free' } = req.body;
    const entry = await CalendarEntry.create({
      kind: 'dayOff',
      date: day,
      label: label || {},
      dayOffKind,
      levels: Array.isArray(levels) ? levels : [],
      createdBy: req.user._id,
    });
    return res.status(201).json(entry);
  }

  // ---- kind === 'lesson' ----
  const { hour, teacher, title } = req.body;
  if (!hour || !teacher || !title) {
    res.status(400);
    throw new Error('hour, teacher, and title are required for a lesson');
  }
  if (![1, 2, 3].includes(Number(hour))) {
    res.status(400); throw new Error('hour must be 1, 2, or 3');
  }

  // Explicit duplicate guard (the unique index is partial and may not
  // have been built on a pre-existing collection).
  const existing = await CalendarEntry.findOne({
    kind: 'lesson',
    teacher,
    date: day,
    hour: Number(hour),
  });
  if (existing) {
    res.status(409);
    throw new Error('That teacher already has a lesson at this hour. Pick a different hour or teacher.');
  }

  try {
    const entry = await CalendarEntry.create({
      kind: 'lesson',
      date: day,
      hour: Number(hour),
      teacher,
      title,
      levels: Array.isArray(levels) ? levels : [],
      status: 'pending',
      createdBy: req.user._id,
    });
    res.status(201).json(entry);
  } catch (e) {
    if (e && e.code === 11000) {
      res.status(409);
      throw new Error('That teacher already has a lesson at this hour. Pick a different hour or teacher.');
    }
    throw e;
  }
});

/* ============================================================ update */

// PUT /api/calendar/:id   (admin)
exports.update = asyncHandler(async (req, res) => {
  const entry = await CalendarEntry.findById(req.params.id);
  if (!entry) { res.status(404); throw new Error('Entry not found'); }

  // Don't allow flipping the kind through update — different shapes,
  // different validation. Easier to delete and recreate.
  if ('kind' in req.body && req.body.kind !== entry.kind) {
    res.status(400); throw new Error('Cannot change entry kind. Delete and recreate instead.');
  }

  // Apply date with UTC normalisation; everything else is plain assignment.
  const fields = entry.kind === 'lesson'
    ? ['hour', 'teacher', 'title', 'levels', 'date']
    : ['label', 'dayOffKind', 'levels', 'date'];
  for (const f of fields) {
    if (f in req.body) {
      entry[f] = f === 'date' ? dayParse(req.body.date) : req.body[f];
    }
  }

  // Reset teacher response if any of the booking-defining fields changed.
  if (entry.kind === 'lesson' &&
      ('teacher' in req.body || 'date' in req.body || 'hour' in req.body)) {
    entry.status = 'pending';
    entry.approvalNote = '';
    entry.approvedAt = null;

    const conflict = await CalendarEntry.findOne({
      _id: { $ne: entry._id },
      kind: 'lesson',
      teacher: entry.teacher,
      date: entry.date,
      hour: entry.hour,
    });
    if (conflict) {
      res.status(409);
      throw new Error('That teacher already has a lesson at this hour.');
    }
  }

  try {
    await entry.save();
    res.json(entry);
  } catch (e) {
    if (e && e.code === 11000) {
      res.status(409);
      throw new Error('That teacher already has a lesson at this hour.');
    }
    throw e;
  }
});

/* ============================================================ delete */

// DELETE /api/calendar/:id   (admin)
exports.remove = asyncHandler(async (req, res) => {
  const e = await CalendarEntry.findByIdAndDelete(req.params.id);
  if (!e) { res.status(404); throw new Error('Entry not found'); }
  res.json({ message: 'Calendar entry removed' });
});

/* ============================================================ respond */

// POST /api/calendar/:id/respond   (teacher)
exports.respond = asyncHandler(async (req, res) => {
  if (req.role !== 'teacher') { res.status(403); throw new Error('Forbidden'); }

  const entry = await CalendarEntry.findById(req.params.id);
  if (!entry) { res.status(404); throw new Error('Entry not found'); }
  if (entry.kind !== 'lesson') {
    res.status(400); throw new Error('Only lesson entries can be responded to');
  }
  if (String(entry.teacher) !== String(req.user._id)) {
    res.status(403); throw new Error('Not your assignment');
  }

  const { status, note } = req.body || {};
  if (!['approved', 'declined'].includes(status)) {
    res.status(400); throw new Error('status must be "approved" or "declined"');
  }

  entry.status = status;
  entry.approvalNote = String(note || '');
  entry.approvedAt = status === 'approved' ? new Date() : null;
  await entry.save();
  res.json(entry);
});
