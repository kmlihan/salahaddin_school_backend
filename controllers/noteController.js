const asyncHandler = require('express-async-handler');
const { childrenScope, childScope } = require('../utils/parentScope');
const Note = require('../models/Note');
const Student = require('../models/Student');

/**
 * GET /api/notes/student/:id
 * Visibility mirrors exam-results:
 *   - admin / teacher: any student
 *   - parent: only their own children
 *   - student: only themselves
 */
exports.byStudent = asyncHandler(async (req, res) => {
  const studentId = req.params.id;
  if (req.role === 'student' && String(req.user._id) !== String(studentId)) {
    res.status(403); throw new Error('Forbidden');
  }
  if (req.role === 'parent') {
    const child = await Student.findOne(childScope(studentId, req.user._id));
    if (!child) { res.status(403); throw new Error('Forbidden'); }
  }
  const notes = await Note.find({ student: studentId }).sort({ createdAt: -1 });
  res.json(notes);
});

/**
 * POST /api/notes
 * Body: { student, scope, lesson?, exam?, examResult?, text:{en,ar,nl}, imageUrl?, videoUrl? }
 * Authors are admin / teacher / parent. Students cannot create notes.
 */
exports.create = asyncHandler(async (req, res) => {
  if (req.role === 'student') { res.status(403); throw new Error('Forbidden'); }

  const { student, scope, lesson, exam, examResult, text, imageUrl, videoUrl } = req.body;

  // Parents may only attach notes to their own children.
  if (req.role === 'parent') {
    const child = await Student.findOne(childScope(student, req.user._id));
    if (!child) { res.status(403); throw new Error('Forbidden — not your child'); }
  }

  const note = await Note.create({
    student,
    scope: scope || 'general',
    lesson, exam, examResult,
    text, imageUrl, videoUrl,
    authorRole: req.role,
    authorId: req.user._id,
    authorName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
  });
  res.status(201).json(note);
});

exports.update = asyncHandler(async (req, res) => {
  const note = await Note.findById(req.params.id);
  if (!note) { res.status(404); throw new Error('Note not found'); }
  // Only the author or an admin may edit.
  if (req.role !== 'admin' && String(note.authorId) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }
  const allowed = ['text', 'imageUrl', 'videoUrl', 'scope', 'lesson', 'exam', 'examResult'];
  for (const k of allowed) if (k in req.body) note[k] = req.body[k];
  await note.save();
  res.json(note);
});

exports.remove = asyncHandler(async (req, res) => {
  const note = await Note.findById(req.params.id);
  if (!note) { res.status(404); throw new Error('Note not found'); }
  if (req.role !== 'admin' && String(note.authorId) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }
  await note.deleteOne();
  res.json({ message: 'Note removed' });
});
