const asyncHandler = require('express-async-handler');
const Lesson = require('../models/Lesson');
const Exam = require('../models/Exam');
const ExamResult = require('../models/ExamResult');
const Student = require('../models/Student');

/**
 * Helper: collect the levels of a lesson regardless of whether it stores
 * them in `levels[]` (new) or `level` (legacy).
 */
function lessonLevels(l) {
  const out = new Set();
  if (Array.isArray(l.levels)) for (const v of l.levels) if (v) out.add(v);
  if (l.level) out.add(l.level);
  return [...out];
}

/**
 * Build a Mongo filter that matches lessons containing a given level in
 * either field — used for the student visibility filter.
 */
function levelMatch(level) {
  return { $or: [{ levels: level }, { level }] };
}

exports.list = asyncHandler(async (req, res) => {
  let filter = {};
  if (req.role === 'teacher') filter.teacher = req.user._id;
  if (req.role === 'student') filter = levelMatch(req.user.level);

  const lessons = await Lesson.find(filter)
    .populate('teacher', 'firstName lastName')
    .sort({ section: 1, order: 1, createdAt: 1 });

  if (req.role !== 'student') return res.json(lessons);

  // Build the set of lesson ids unlocked by an exam pass.
  const passedResults = await ExamResult.find({
    student: req.user._id,
    passed: true,
  }).select('exam').lean();
  const passedExamIds = passedResults.map((r) => String(r.exam));
  const examUnlockedLessonIds = new Set();
  if (passedExamIds.length) {
    const examsCovering = await Exam.find({ _id: { $in: passedExamIds } })
      .select('lessons').lean();
    for (const ex of examsCovering) {
      for (const lid of ex.lessons || []) examUnlockedLessonIds.add(String(lid));
    }
  }

  const viewed = new Set((req.user.viewedLessons || []).map(String));
  const bySection = {};
  for (const l of lessons) {
    const sec = l.section || '_';
    (bySection[sec] = bySection[sec] || []).push(l);
  }

  const out = [];
  for (const sec of Object.keys(bySection)) {
    let previousId = null;
    for (const l of bySection[sec]) {
      const isFirst = previousId === null;
      const previousViewed = previousId && viewed.has(String(previousId));
      const passedCoveringExam = examUnlockedLessonIds.has(String(l._id));
      const locked = !(isFirst || previousViewed || passedCoveringExam);
      out.push({ ...l.toObject(), locked });
      previousId = l._id;
    }
  }
  res.json(out);
});

exports.getOne = asyncHandler(async (req, res) => {
  const lesson = await Lesson.findById(req.params.id).populate('teacher', 'firstName lastName');
  if (!lesson) { res.status(404); throw new Error('Lesson not found'); }

  if (req.role === 'teacher' && String(lesson.teacher?._id) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }
  if (req.role === 'student') {
    const levels = lessonLevels(lesson);
    if (!levels.includes(req.user.level)) {
      res.status(403); throw new Error('Lesson is not for your level');
    }
  }

  if (req.role === 'student') {
    await Student.updateOne(
      { _id: req.user._id },
      { $addToSet: { viewedLessons: lesson._id } }
    );
  }
  res.json(lesson);
});

// POST /api/lessons
exports.create = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (req.role === 'teacher') payload.teacher = req.user._id;
  // Normalise: if only `level` was sent, also fill `levels`.
  if (payload.level && !Array.isArray(payload.levels)) payload.levels = [payload.level];
  const lesson = await Lesson.create(payload);
  res.status(201).json(lesson);
});

// PUT /api/lessons/:id
exports.update = asyncHandler(async (req, res) => {
  const lesson = await Lesson.findById(req.params.id);
  if (!lesson) { res.status(404); throw new Error('Lesson not found'); }
  if (req.role === 'teacher' && String(lesson.teacher) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden — not your lesson');
  }
  Object.assign(lesson, req.body);
  if (req.role === 'teacher') lesson.teacher = req.user._id;
  if (lesson.level && (!lesson.levels || lesson.levels.length === 0)) {
    lesson.levels = [lesson.level];
  }
  await lesson.save();
  res.json(lesson);
});

// DELETE /api/lessons/:id
exports.remove = asyncHandler(async (req, res) => {
  const lesson = await Lesson.findById(req.params.id);
  if (!lesson) { res.status(404); throw new Error('Lesson not found'); }
  if (req.role === 'teacher' && String(lesson.teacher) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden — not your lesson');
  }
  await lesson.deleteOne();
  res.json({ message: 'Lesson removed' });
});

/**
 * POST /api/lessons/:id/copy
 *
 * Duplicates a lesson — same blocks, same levels, same section. The copy's
 * title gets " (copy)" / " (نسخة)" / " (kopie)" appended for whichever
 * languages are filled in. Teacher field is reset to the user making the
 * copy if they're a teacher (so they own the new copy and can modify it).
 */
exports.copy = asyncHandler(async (req, res) => {
  const src = await Lesson.findById(req.params.id);
  if (!src) { res.status(404); throw new Error('Lesson not found'); }

  // Build the new title by appending a "copy" suffix per language.
  const t = src.title || {};
  const title = {
    en: t.en ? `${t.en} (copy)` : '',
    ar: t.ar ? `${t.ar} (نسخة)` : '',
    nl: t.nl ? `${t.nl} (kopie)` : '',
  };

  // Strip block _ids so Mongo generates fresh ones for the copy.
  const blocks = (src.blocks || []).map((b) => {
    const o = b.toObject ? b.toObject() : { ...b };
    delete o._id;
    return o;
  });

  const copyPayload = {
    title,
    section: src.section,
    unit: src.unit,
    unitName: src.unitName,
    order: (src.order || 0) + 1,
    levels: Array.isArray(src.levels) && src.levels.length ? [...src.levels] : (src.level ? [src.level] : []),
    teacher: req.role === 'teacher' ? req.user._id : src.teacher,
    blocks,
  };

  const copy = await Lesson.create(copyPayload);
  res.status(201).json(copy);
});
