const asyncHandler = require('express-async-handler');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const generatePassword = require('../utils/generatePassword');

exports.list = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const filter = {};
  if (q && q.trim()) {
    const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }];
  }
  const parents = await Parent.find(filter).select('-password').sort({ createdAt: -1 });
  res.json(parents);
});

exports.getOne = asyncHandler(async (req, res) => {
  const parent = await Parent.findById(req.params.id).select('-password');
  if (!parent) { res.status(404); throw new Error('Parent not found'); }
  res.json(parent);
});

exports.create = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone } = req.body;
  if (!firstName || !lastName || !email) {
    res.status(400);
    throw new Error('firstName, lastName, email are required');
  }
  const password = generatePassword(firstName, lastName);
  const parent = await Parent.create({ firstName, lastName, email, phone, password });
  const safe = parent.toObject();
  delete safe.password;
  res.status(201).json({ ...safe, generatedPassword: password });
});

exports.update = asyncHandler(async (req, res) => {
  const allowed = ['firstName', 'lastName', 'email', 'phone'];
  const update = {};
  for (const k of allowed) if (k in req.body) update[k] = req.body[k];
  const parent = await Parent.findByIdAndUpdate(req.params.id, update, {
    new: true, runValidators: true,
  }).select('-password');
  if (!parent) { res.status(404); throw new Error('Parent not found'); }
  res.json(parent);
});

exports.remove = asyncHandler(async (req, res) => {
  const parent = await Parent.findByIdAndDelete(req.params.id);
  if (!parent) { res.status(404); throw new Error('Parent not found'); }
  // Detach students from this parent rather than deleting them.
  // Handles both the new parents[] array and the legacy single `parent`
  // field; the latter is unset, the former has the entry pulled out.
  await Student.updateMany(
    { parent: parent._id },
    { $unset: { parent: '' } }
  );
  await Student.updateMany(
    { 'parents.parent': parent._id },
    { $pull: { parents: { parent: parent._id } } }
  );
  res.json({ message: 'Parent removed' });
});

// GET /api/parents/me/children — list current parent's children
// Both parents in a child's parents[] array have full access. We $or with
// the legacy single-parent field too so older docs still resolve.
exports.myChildren = asyncHandler(async (req, res) => {
  const children = await Student.find({
    $or: [
      { 'parents.parent': req.user._id },
      { parent: req.user._id },
    ],
  })
    .populate('parents.parent', 'firstName lastName email')
    .populate('parent',         'firstName lastName email')
    .select('-password');
  res.json(children);
});
