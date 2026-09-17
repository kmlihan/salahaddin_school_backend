const asyncHandler = require('express-async-handler');
const Teacher = require('../models/Teacher');
const generatePassword = require('../utils/generatePassword');

// GET /api/teachers?q=&gender=
// `q` is a free-text search across firstName, lastName, email, phone.
// `gender` filters when the teacher record has a gender field (kept optional —
// teachers don't have one in the schema today, but the filter is harmless).
exports.list = asyncHandler(async (req, res) => {
  const { q, gender } = req.query;
  const filter = {};
  if (q && q.trim()) {
    const rx = new RegExp(escapeRegex(q.trim()), 'i');
    filter.$or = [
      { firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx },
    ];
  }
  if (gender) filter.gender = gender;
  const teachers = await Teacher.find(filter).select('-password').sort({ createdAt: -1 });
  res.json(teachers);
});

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/teachers/:id
exports.getOne = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findById(req.params.id).select('-password');
  if (!teacher) { res.status(404); throw new Error('Teacher not found'); }
  res.json(teacher);
});

// POST /api/teachers
exports.create = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, photo, hourlyRate } = req.body;
  if (!firstName || !lastName || !email) {
    res.status(400);
    throw new Error('firstName, lastName, email are required');
  }

  const password = generatePassword(firstName, lastName);
  const teacher = await Teacher.create({
    firstName, lastName, email, phone, photo, hourlyRate, password,
  });

  // Surface the generated password ONCE so the admin can communicate it.
  const safe = teacher.toObject();
  delete safe.password;
  res.status(201).json({ ...safe, generatedPassword: password });
});

// PUT /api/teachers/:id
exports.update = asyncHandler(async (req, res) => {
  const allowed = ['firstName', 'lastName', 'email', 'phone', 'photo', 'hourlyRate'];
  const update = {};
  for (const k of allowed) if (k in req.body) update[k] = req.body[k];

  const teacher = await Teacher.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  }).select('-password');
  if (!teacher) { res.status(404); throw new Error('Teacher not found'); }
  res.json(teacher);
});

// DELETE /api/teachers/:id
exports.remove = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findByIdAndDelete(req.params.id);
  if (!teacher) { res.status(404); throw new Error('Teacher not found'); }
  res.json({ message: 'Teacher removed' });
});
