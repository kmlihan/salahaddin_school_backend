const asyncHandler = require('express-async-handler');
const Exam = require('../models/Exam');
const ExamResult = require('../models/ExamResult');
const Student = require('../models/Student');

// LIST -------------------------------------------------------------------
exports.list = asyncHandler(async (req, res) => {
  let filter = {};
  // Note: admins, teachers, AND parents now see all exams (per the spec).
  // Teachers still see only their own; parents see all because they need
  // visibility into anything their child might take or have taken.
  if (req.role === 'teacher') filter.teacher = req.user._id;
  if (req.role === 'student') filter.level = req.user.level;

  const exams = await Exam.find(filter)
    .populate('teacher', 'firstName lastName')
    .sort({ section: 1, createdAt: -1 });

  // For students, hide correct answers AND mark which exams they've already taken.
  if (req.role === 'student') {
    const taken = await ExamResult.find({ student: req.user._id }).select('exam').lean();
    const takenSet = new Set(taken.map((t) => String(t.exam)));
    return res.json(exams.map((e) => ({
      ...stripAnswers(e.toObject()),
      alreadyTaken: takenSet.has(String(e._id)),
    })));
  }
  res.json(exams);
});

exports.getOne = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id).populate('teacher', 'firstName lastName');
  if (!exam) { res.status(404); throw new Error('Exam not found'); }

  if (req.role === 'teacher' && String(exam.teacher?._id) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }
  if (req.role === 'student' && exam.level !== req.user.level) {
    res.status(403); throw new Error('Exam is not for your level');
  }

  // Students see the exam stripped of correct answers AND we tell them whether
  // they've already taken it (so the UI can hide "start exam").
  if (req.role === 'student') {
    const existing = await ExamResult.findOne({ student: req.user._id, exam: exam._id })
      .select('_id percentage passed').lean();
    return res.json({
      ...stripAnswers(exam.toObject()),
      alreadyTaken: !!existing,
      previousResultId: existing?._id || null,
    });
  }
  res.json(exam);
});

exports.create = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (req.role === 'teacher') payload.teacher = req.user._id;
  const exam = await Exam.create(payload);
  res.status(201).json(exam);
});

exports.update = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) { res.status(404); throw new Error('Exam not found'); }
  if (req.role === 'teacher' && String(exam.teacher) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden — not your exam');
  }
  Object.assign(exam, req.body);
  if (req.role === 'teacher') exam.teacher = req.user._id;
  await exam.save();
  res.json(exam);
});

exports.remove = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) { res.status(404); throw new Error('Exam not found'); }
  if (req.role === 'teacher' && String(exam.teacher) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden — not your exam');
  }
  await exam.deleteOne();
  res.json({ message: 'Exam removed' });
});

// ------------------------------------------------------------------ submit
/**
 * POST /api/exams/:id/submit
 * Body: { answers: [{ questionId, answer }] }
 * Returns the graded ExamResult. If the exam is type=unit and the student
 * passes, mark the unit as completed (unlocks the next unit's lessons).
 */
exports.submit = asyncHandler(async (req, res) => {
  if (req.role !== 'student') {
    res.status(403); throw new Error('Only students can submit exams');
  }

  const exam = await Exam.findById(req.params.id);
  if (!exam) { res.status(404); throw new Error('Exam not found'); }
  if (exam.level !== req.user.level) {
    res.status(403); throw new Error('Exam is not for your level');
  }

  // One attempt per exam per student. If a result already exists, refuse.
  const existing = await ExamResult.findOne({ student: req.user._id, exam: exam._id });
  if (existing) {
    res.status(409);
    throw new Error('You have already taken this exam');
  }

  const submitted = req.body.answers || [];
  const answers = [];
  let totalScore = 0;
  let maxScore = 0;

  for (const q of exam.questions) {
    const found = submitted.find((s) => String(s.questionId) === String(q._id));
    const userAnswer = found ? found.answer : null;
    const { earned, correct } = grade(q, userAnswer);
    totalScore += earned;
    maxScore += q.score || 1;
    answers.push({
      questionId: q._id,
      answer: userAnswer,
      scoreEarned: earned,
      scoreMax: q.score || 1,
      correct,
    });
  }

  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const passed = percentage >= (exam.passingGrade || 50);

  const result = await ExamResult.create({
    student: req.user._id,
    exam: exam._id,
    answers,
    totalScore,
    maxScore,
    percentage,
    passed,
  });

  // Progressive unlock: if this is a unit exam and the student passed,
  // record the unit as completed.
  if (passed && exam.type === 'unit' && exam.unit) {
    await Student.updateOne(
      { _id: req.user._id },
      { $addToSet: { completedUnits: exam.unit } }
    );
  }

  res.status(201).json(result);
});

// helpers ----------------------------------------------------------------
function stripAnswers(exam) {
  const e = { ...exam };
  e.questions = (e.questions || []).map((q) => {
    const out = { ...q };
    delete out.correctIndices;
    delete out.correctBoolean;
    delete out.acceptableAnswers;
    if (out.matchPairs) out.matchPairs = out.matchPairs.map((p) => ({ left: p.left, right: p.right }));
    if (out.blanks) out.blanks = out.blanks.map(() => ({})); // hide acceptable
    // For ordering, the stored order IS the answer — the client must shuffle.
    return out;
  });
  return e;
}

/** Grade a single question. Returns { earned, correct } */
function grade(q, answer) {
  const max = q.score || 1;

  switch (q.type) {
    case 'mcq': {
      const correct = new Set((q.correctIndices || []).map(Number));
      const given = new Set(Array.isArray(answer) ? answer.map(Number) : [Number(answer)]);
      const ok = given.size === correct.size && [...given].every((i) => correct.has(i));
      return { earned: ok ? max : 0, correct: ok };
    }
    case 'truefalse': {
      const ok = Boolean(answer) === Boolean(q.correctBoolean);
      return { earned: ok ? max : 0, correct: ok };
    }
    case 'matching': {
      // answer = [{ leftIndex, rightIndex }]
      if (!Array.isArray(answer)) return { earned: 0, correct: false };
      const totalPairs = q.matchPairs.length;
      let okCount = 0;
      for (const a of answer) {
        if (Number(a.leftIndex) === Number(a.rightIndex)) okCount += 1;
      }
      const earned = totalPairs > 0 ? Math.round((okCount / totalPairs) * max) : 0;
      return { earned, correct: okCount === totalPairs };
    }
    case 'fillblank': {
      // answer = [string]
      if (!Array.isArray(answer)) return { earned: 0, correct: false };
      const blanks = q.blanks || [];
      let okCount = 0;
      for (let i = 0; i < blanks.length; i++) {
        const acc = (blanks[i].acceptable || []).map((s) => String(s).trim().toLowerCase());
        const got = String(answer[i] || '').trim().toLowerCase();
        if (acc.includes(got)) okCount += 1;
      }
      const earned = blanks.length > 0 ? Math.round((okCount / blanks.length) * max) : 0;
      return { earned, correct: okCount === blanks.length };
    }
    case 'ordering': {
      // answer = [originalIndex, originalIndex, ...] in the order chosen by student
      if (!Array.isArray(answer)) return { earned: 0, correct: false };
      const ok = answer.every((idx, i) => Number(idx) === i);
      return { earned: ok ? max : 0, correct: ok };
    }
    case 'shortanswer': {
      const acc = (q.acceptableAnswers || []).map((s) => String(s).trim().toLowerCase());
      const got = String(answer || '').trim().toLowerCase();
      const ok = acc.length > 0 && acc.includes(got);
      // If no acceptable answers configured, leave to manual review (0 for now).
      return { earned: ok ? max : 0, correct: ok };
    }
    default:
      return { earned: 0, correct: false };
  }
}
