const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Student = require('../models/Student');
const generatePassword = require('../utils/generatePassword');

const { levelFromBirthDate } = Student;

/* ============================================================ helpers */

/**
 * Visibility:
 *   admin / teacher  — every student
 *   parent           — any student where the parent appears in `parents[]`
 *                      OR in the legacy single-`parent` field. We $or
 *                      both during the migration window so older docs
 *                      that haven't been re-saved still match.
 */
function visibilityFilter(req) {
  if (req.role === 'parent') {
    return {
      $or: [
        { 'parents.parent': req.user._id },
        { parent: req.user._id },
      ],
    };
  }
  return {};
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ----- validation primitives ----- */

const EMAIL_RX  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RX  = /^\+[1-9]\d{6,14}$/; // E.164: + then 7–15 digits, first non-zero
const POSTAL_RX = /^[A-Za-z0-9 \-]{2,12}$/; // permissive; specifics vary by country

function bad(res, msg) {
  res.status(400);
  throw new Error(msg);
}

/**
 * Validate the full student write payload. Used on both create and update.
 * Returns the cleaned object; throws on invalid input.
 *
 * `mode` is 'create' or 'update' — required-ness depends on it.
 */
function validateStudentPayload(body, mode, res) {
  const out = {};

  // ---- name ----
  if ('firstName' in body || mode === 'create') {
    const v = String(body.firstName || '').trim();
    if (mode === 'create' && !v) bad(res, 'firstName is required');
    if (v && (v.length < 1 || v.length > 80)) bad(res, 'firstName must be 1–80 characters');
    if (v) out.firstName = v;
  }
  if ('lastName' in body || mode === 'create') {
    const v = String(body.lastName || '').trim();
    if (mode === 'create' && !v) bad(res, 'lastName is required');
    if (v && (v.length < 1 || v.length > 80)) bad(res, 'lastName must be 1–80 characters');
    if (v) out.lastName = v;
  }

  // ---- email ----
  if ('email' in body || mode === 'create') {
    const v = String(body.email || '').trim().toLowerCase();
    if (mode === 'create' && !v) bad(res, 'email is required');
    if (v && !EMAIL_RX.test(v)) bad(res, 'Invalid email format');
    if (v) out.email = v;
  }

  // ---- gender ----
  if ('gender' in body) {
    if (!['male', 'female'].includes(body.gender)) bad(res, 'gender must be male or female');
    out.gender = body.gender;
  }

  // ---- birthDate (mandatory on create, drives auto-level) ----
  if ('birthDate' in body || mode === 'create') {
    const v = body.birthDate;
    if (mode === 'create' && !v) bad(res, 'birthDate is required');
    if (v) {
      const d = new Date(v);
      if (isNaN(d.getTime())) bad(res, 'Invalid birthDate');
      const now = Date.now();
      if (d.getTime() > now) bad(res, 'birthDate cannot be in the future');
      // Sanity floor: nobody alive is older than ~120
      if (d.getTime() < now - 120 * 365 * 24 * 60 * 60 * 1000) {
        bad(res, 'birthDate is unreasonably old');
      }
      out.birthDate = d;
    }
  }

  // ---- level ----
  // If level is missing on create, auto-assign A or B from age. If age is
  // outside the auto-range and no level was provided, the caller has to
  // pick C or D explicitly.
  if ('level' in body) {
    if (!['A', 'B', 'C', 'D'].includes(body.level)) bad(res, 'level must be A, B, C, or D');
    out.level = body.level;
  } else if (mode === 'create') {
    const auto = levelFromBirthDate(out.birthDate);
    if (!auto) {
      bad(res, 'level is required (age outside the 6–16 auto-range; pick C or D explicitly)');
    }
    out.level = auto;
  }

  // ---- phones ----
  // Student's own phone is optional; emergency phone is required on create.
  if ('phone' in body) {
    const v = String(body.phone || '').trim();
    if (v && !PHONE_RX.test(v)) bad(res, 'Invalid phone format (use international format, e.g. +32…)');
    out.phone = v;
  }
  if ('emergencyPhone' in body || mode === 'create') {
    const v = String(body.emergencyPhone || '').trim();
    if (mode === 'create' && !v) bad(res, 'emergencyPhone is required');
    if (v && !PHONE_RX.test(v)) bad(res, 'Invalid emergencyPhone format (use international format, e.g. +32…)');
    if (v) out.emergencyPhone = v;
  }

  // ---- address ----
  if ('address' in body || mode === 'create') {
    const a = body.address || {};
    const street      = String(a.street || '').trim();
    const houseNumber = String(a.houseNumber || '').trim();
    const city        = String(a.city || '').trim();
    const postalCode  = String(a.postalCode || '').trim();
    const country     = String(a.country || '').trim();

    if (mode === 'create') {
      if (!street)      bad(res, 'address.street is required');
      if (!houseNumber) bad(res, 'address.houseNumber is required');
      if (!city)        bad(res, 'address.city is required');
      if (!postalCode)  bad(res, 'address.postalCode is required');
      if (!country)     bad(res, 'address.country is required');
    }
    if (postalCode && !POSTAL_RX.test(postalCode)) {
      bad(res, 'Invalid postalCode format');
    }
    out.address = { street, houseNumber, city, postalCode, country };
  }

  // ---- parents ----
  // Accept either:
  //   parents: [{ parent: id, relationship: 'mother'|'father'|'guardian'|'other' }, ...]
  //   parent:  <id>   (legacy shape — auto-wrapped into a single 'guardian' entry)
  if ('parents' in body || 'parent' in body || mode === 'create') {
    let arr = [];
    if (Array.isArray(body.parents) && body.parents.length > 0) {
      arr = body.parents;
    } else if (body.parent) {
      arr = [{ parent: body.parent, relationship: 'guardian' }];
    }
    if (mode === 'create' && arr.length === 0) {
      bad(res, 'At least one parent is required');
    }
    const REL = ['mother', 'father', 'guardian', 'other'];
    const seen = new Set();
    for (const item of arr) {
      if (!item || !mongoose.isValidObjectId(item.parent)) {
        bad(res, 'Each parents[] entry needs a valid parent id');
      }
      if (!REL.includes(item.relationship)) {
        bad(res, 'Each parents[] entry needs a relationship of mother/father/guardian/other');
      }
      const key = String(item.parent);
      if (seen.has(key)) bad(res, 'Duplicate parent in parents[]');
      seen.add(key);
    }
    if (arr.length > 0) {
      out.parents = arr.map((it) => ({
        parent: it.parent,
        relationship: it.relationship,
      }));
    }
  }

  // ---- misc passthroughs ----
  if ('photo' in body)      out.photo = String(body.photo || '');
  if ('paidAmount' in body) {
    const n = Number(body.paidAmount);
    if (!Number.isFinite(n) || n < 0) bad(res, 'paidAmount must be a non-negative number');
    out.paidAmount = n;
  }

  return out;
}

/* ============================================================ list */

exports.list = asyncHandler(async (req, res) => {
  const filter = visibilityFilter(req);
  const { q, gender } = req.query;
  if (q && q.trim()) {
    const rx = new RegExp(escapeRegex(q.trim()), 'i');
    // Combine search with the role filter via $and so we don't replace
    // the parent's $or visibility.
    const search = { $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] };
    Object.assign(filter, filter.$or
      ? { $and: [{ $or: filter.$or }, search] }
      : search);
    if (filter.$and) delete filter.$or;
  }
  if (gender) filter.gender = gender;

  const students = await Student.find(filter)
    .populate('parents.parent', 'firstName lastName email')
    .populate('parent', 'firstName lastName email')
    .select('-password')
    .sort({ createdAt: -1 });
  res.json(students);
});

/* ============================================================ upcomingBirthdays */

/**
 * Same logic as before — student birthdays in the next N days. The
 * visibility filter now uses $or for parents, so we pass it through the
 * aggregation $match unchanged.
 */
exports.upcomingBirthdays = asyncHandler(async (req, res) => {
  const days = Math.max(1, Math.min(60, Number(req.query.days) || 10));

  const today = new Date();
  const startDOY = dayOfYear(today);
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + days);
  const endDOY = dayOfYear(endDate);

  const wraps = endDOY < startDOY;
  const baseFilter = visibilityFilter(req);

  const pipeline = [
    { $match: { ...baseFilter, birthDate: { $ne: null, $exists: true } } },
    { $addFields: { _dayOfYear: { $dayOfYear: '$birthDate' } } },
    {
      $match: wraps
        ? { $or: [{ _dayOfYear: { $gte: startDOY } }, { _dayOfYear: { $lte: endDOY } }] }
        : { _dayOfYear: { $gte: startDOY, $lte: endDOY } },
    },
    {
      $addFields: {
        _daysAway: {
          $cond: [
            { $gte: ['$_dayOfYear', startDOY] },
            { $subtract: ['$_dayOfYear', startDOY] },
            { $add: [{ $subtract: [365, startDOY] }, '$_dayOfYear'] },
          ],
        },
      },
    },
    { $sort: { _daysAway: 1, lastName: 1 } },
    { $project: { password: 0 } },
  ];

  const docs = await Student.aggregate(pipeline);
  await Student.populate(docs, { path: 'parents.parent', select: 'firstName lastName email' });
  await Student.populate(docs, { path: 'parent',         select: 'firstName lastName email' });

  res.json(
    docs.map((d) => ({
      ...d,
      daysAway: d._daysAway,
      _dayOfYear: undefined,
      _daysAway: undefined,
    }))
  );
});

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/* ============================================================ getOne */

exports.getOne = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id)
    .populate('parents.parent', 'firstName lastName email phone')
    .populate('parent',         'firstName lastName email phone')
    .select('-password');
  if (!student) { res.status(404); throw new Error('Student not found'); }

  if (req.role === 'parent') {
    const me = String(req.user._id);
    const inParents = (student.parents || []).some((p) => String(p.parent?._id || p.parent) === me);
    const isLegacy  = String(student.parent?._id || student.parent) === me;
    if (!inParents && !isLegacy) { res.status(403); throw new Error('Forbidden'); }
  }
  if (req.role === 'student' && String(student._id) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }
  res.json(student);
});

/* ============================================================ create / update / delete */

exports.create = asyncHandler(async (req, res) => {
  const data = validateStudentPayload(req.body, 'create', res);

  // Duplicate-email guard. The schema has unique:true but a clean 4xx is
  // friendlier than a Mongo 11000 error.
  const existing = await Student.findOne({ email: data.email });
  if (existing) {
    res.status(409);
    throw new Error('A student with that email already exists.');
  }

  const password = generatePassword(data.firstName, data.lastName);
  const student = await Student.create({ ...data, password });

  const safe = student.toObject();
  delete safe.password;
  res.status(201).json({ ...safe, generatedPassword: password });
});

exports.update = asyncHandler(async (req, res) => {
  const data = validateStudentPayload(req.body, 'update', res);

  // If the email was changed, make sure it isn't taken.
  if (data.email) {
    const existing = await Student.findOne({ email: data.email, _id: { $ne: req.params.id } });
    if (existing) {
      res.status(409);
      throw new Error('A student with that email already exists.');
    }
  }

  // Use save() so the pre('save') hook keeps `parent` synced to parents[0].
  const student = await Student.findById(req.params.id);
  if (!student) { res.status(404); throw new Error('Student not found'); }
  Object.assign(student, data);
  await student.save();

  const safe = await Student.findById(student._id)
    .populate('parents.parent', 'firstName lastName email')
    .populate('parent',         'firstName lastName email')
    .select('-password');
  res.json(safe);
});

exports.remove = asyncHandler(async (req, res) => {
  const student = await Student.findByIdAndDelete(req.params.id);
  if (!student) { res.status(404); throw new Error('Student not found'); }
  res.json({ message: 'Student removed' });
});
