const asyncHandler = require('express-async-handler');
const { childrenScope, childScope } = require('../utils/parentScope');
const Homework = require('../models/Homework');
const HomeworkSubmission = require('../models/HomeworkSubmission');
const Student = require('../models/Student');

/**
 * Visibility per role:
 *   admin   — all
 *   teacher — homeworks they created
 *   student — those at their level, plus any explicitly assigned to them
 *   parent  — homeworks at any of their children's level (so they can
 *             read instructions / leave parent-notes for book reading)
 */

// GET /api/homeworks
exports.list = asyncHandler(async (req, res) => {
  const filter = {};

  // Teachers see ALL homework — they often need to coordinate with each
  // other and check submissions for students they teach across subjects.
  // We deliberately do NOT filter by teacher here. Modifying is still
  // restricted to the original author (see update/remove below).
  if (req.role === 'student') {
    filter.$or = [
      { level: req.user.level, assignedTo: { $size: 0 } },
      { assignedTo: req.user._id },
    ];
  } else if (req.role === 'parent') {
    const children = await Student.find(childrenScope(req.user._id)).select('_id level');
    const levels = [...new Set(children.map((c) => c.level))];
    filter.level = { $in: levels };
  }

  const items = await Homework.find(filter)
    .populate('teacher', 'firstName lastName')
    .sort({ dueDate: 1, createdAt: -1 });

  // For students, also annotate with their own submission status — saves
  // a round-trip on the list page.
  if (req.role === 'student') {
    const subs = await HomeworkSubmission.find({
      student: req.user._id,
      homework: { $in: items.map((h) => h._id) },
    }).lean();
    const byHw = {};
    for (const s of subs) byHw[String(s.homework)] = s;
    return res.json(items.map((h) => ({
      ...h.toObject(),
      mySubmission: byHw[String(h._id)] || null,
    })));
  }

  res.json(items);
});

// GET /api/homeworks/:id
exports.getOne = asyncHandler(async (req, res) => {
  const hw = await Homework.findById(req.params.id).populate('teacher', 'firstName lastName');
  if (!hw) { res.status(404); throw new Error('Homework not found'); }

  // Cheap permission check — students can only see homeworks for their
  // level or that target them directly; parents anything matching one of
  // their children's levels. Teachers and admins can read any homework
  // (cross-author visibility); modifying is still restricted, see update().
  if (req.role === 'student') {
    const targeted = (hw.assignedTo || []).some((id) => String(id) === String(req.user._id));
    if (!targeted && hw.level !== req.user.level) {
      res.status(403); throw new Error('Forbidden');
    }
  }
  if (req.role === 'parent') {
    const children = await Student.find(childrenScope(req.user._id)).select('level');
    const ok = children.some((c) => c.level === hw.level);
    if (!ok) { res.status(403); throw new Error('Forbidden'); }
  }

  res.json(hw);
});

// POST /api/homeworks  (teacher / admin)
exports.create = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (req.role === 'teacher') payload.teacher = req.user._id;
  // Strip prompts when not a writing homework, just to keep the document tidy.
  if (payload.kind !== 'writing') delete payload.prompts;
  const hw = await Homework.create(payload);
  res.status(201).json(hw);
});

// PUT /api/homeworks/:id
exports.update = asyncHandler(async (req, res) => {
  const hw = await Homework.findById(req.params.id);
  if (!hw) { res.status(404); throw new Error('Homework not found'); }
  if (req.role === 'teacher' && String(hw.teacher) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden — not your homework');
  }
  Object.assign(hw, req.body);
  if (req.role === 'teacher') hw.teacher = req.user._id;
  if (hw.kind !== 'writing') hw.prompts = undefined;
  await hw.save();
  res.json(hw);
});

// DELETE /api/homeworks/:id
exports.remove = asyncHandler(async (req, res) => {
  const hw = await Homework.findById(req.params.id);
  if (!hw) { res.status(404); throw new Error('Homework not found'); }
  if (req.role === 'teacher' && String(hw.teacher) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden — not your homework');
  }
  await hw.deleteOne();
  // Cascade: clean up submissions so we don't leave orphans.
  await HomeworkSubmission.deleteMany({ homework: hw._id });
  res.json({ message: 'Homework removed' });
});

/* ----------------------------------------------------------------- submit */

/** Light normalisation for Arabic / Latin text comparisons. */
function norm(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * POST /api/homeworks/:id/submit  (student)
 * Body shape depends on the homework's kind:
 *   writing         -> { answers: [string, ...] }
 *   recordedReading -> { audioUrl: string }
 *   bookReading     -> rejected here; parents use /parent-note
 */
exports.submit = asyncHandler(async (req, res) => {
  if (req.role !== 'student') { res.status(403); throw new Error('Forbidden'); }
  const hw = await Homework.findById(req.params.id);
  if (!hw) { res.status(404); throw new Error('Homework not found'); }
  if (hw.level !== req.user.level
      && !(hw.assignedTo || []).some((id) => String(id) === String(req.user._id))) {
    res.status(403); throw new Error('Forbidden');
  }

  if (hw.kind === 'bookReading') {
    res.status(400);
    throw new Error('Book reading homework is confirmed by a parent note, not by the student');
  }

  const update = { kind: hw.kind, submittedAt: new Date() };

  if (hw.kind === 'writing') {
    const answers = Array.isArray(req.body.answers) ? req.body.answers.map(String) : [];
    let correct = 0;
    const total = (hw.prompts || []).length;
    for (let i = 0; i < total; i++) {
      if (norm(answers[i]) === norm(hw.prompts[i].answer)) correct += 1;
    }
    update.answers = answers;
    update.autoScore = total > 0 ? Math.round((correct / total) * 100) : null;
  } else if (hw.kind === 'recordedReading') {
    if (!req.body.audioUrl) {
      res.status(400); throw new Error('audioUrl required');
    }
    update.audioUrl = String(req.body.audioUrl);
  }

  const sub = await HomeworkSubmission.findOneAndUpdate(
    { homework: hw._id, student: req.user._id },
    { $set: update, $setOnInsert: { homework: hw._id, student: req.user._id } },
    { new: true, upsert: true }
  );

  res.status(201).json(sub);
});

/**
 * POST /api/homeworks/:id/parent-note  (parent)
 * Body: { studentId, note: { en, ar, nl } }
 * Used for bookReading homeworks; parent records that their child read the
 * page and writes a note. Flips `confirmedByParent` to true.
 */
exports.parentNote = asyncHandler(async (req, res) => {
  if (req.role !== 'parent') { res.status(403); throw new Error('Forbidden'); }
  const { studentId, note } = req.body || {};
  if (!studentId) { res.status(400); throw new Error('studentId required'); }

  // Make sure the student is actually one of this parent's children.
  const child = await Student.findOne(childScope(studentId, req.user._id));
  if (!child) { res.status(403); throw new Error('Not your child'); }

  const hw = await Homework.findById(req.params.id);
  if (!hw) { res.status(404); throw new Error('Homework not found'); }
  if (hw.kind !== 'bookReading') {
    res.status(400);
    throw new Error('Parent notes are only for book-reading homework');
  }
  if (hw.level !== child.level) {
    res.status(400); throw new Error('Homework is not for your child\'s level');
  }

  const sub = await HomeworkSubmission.findOneAndUpdate(
    { homework: hw._id, student: child._id },
    {
      $set: {
        kind: 'bookReading',
        parentNote: note || {},
        parentNoteBy: req.user._id,
        confirmedByParent: true,
        submittedAt: new Date(),
      },
      $setOnInsert: { homework: hw._id, student: child._id },
    },
    { new: true, upsert: true }
  );

  res.status(201).json(sub);
});

/* -------------------------------------------------- submissions for review */

// GET /api/homeworks/:id/submissions  (teacher / admin)
exports.listSubmissions = asyncHandler(async (req, res) => {
  const hw = await Homework.findById(req.params.id);
  if (!hw) { res.status(404); throw new Error('Homework not found'); }
  // Any teacher can view submissions; only the original author (or admin)
  // can grade them — that check lives on the updateSubmission endpoint.
  const subs = await HomeworkSubmission.find({ homework: hw._id })
    .populate('student', 'firstName lastName level photo gender')
    .sort({ submittedAt: -1 });
  res.json(subs);
});

// PUT /api/homework-submissions/:id  (teacher / admin)
exports.updateSubmission = asyncHandler(async (req, res) => {
  const sub = await HomeworkSubmission.findById(req.params.id);
  if (!sub) { res.status(404); throw new Error('Submission not found'); }
  // Teachers can only review their own homeworks' submissions.
  if (req.role === 'teacher') {
    const hw = await Homework.findById(sub.homework);
    if (!hw || String(hw.teacher) !== String(req.user._id)) {
      res.status(403); throw new Error('Forbidden');
    }
  }
  const allowed = ['teacherFeedback', 'teacherScore'];
  for (const k of allowed) if (k in req.body) sub[k] = req.body[k];
  await sub.save();
  res.json(sub);
});

/**
 * GET /api/homeworks/:id/submission?student=<studentId>
 *
 * Lookup a single submission for one (homework, student). Visibility:
 *   - admin / teacher: any
 *   - parent: only for their own children
 *   - student: only for themselves
 *
 * Returns null if no submission exists yet (HTTP 200 with body `null`).
 */
exports.getOneSubmission = asyncHandler(async (req, res) => {
  const hwId = req.params.id;
  const studentId = req.query.student || (req.role === 'student' ? req.user._id : null);
  if (!studentId) { res.status(400); throw new Error('student required'); }

  if (req.role === 'parent') {
    const child = await Student.findOne(childScope(studentId, req.user._id));
    if (!child) { res.status(403); throw new Error('Forbidden'); }
  }
  if (req.role === 'student' && String(studentId) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }
  // Teachers can view any submission, regardless of who authored the
  // homework — only grading (updateSubmission) is restricted to the
  // homework's author.

  const sub = await HomeworkSubmission.findOne({ homework: hwId, student: studentId });
  res.json(sub || null);
});
