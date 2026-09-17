const asyncHandler = require('express-async-handler');
const CultureSection = require('../models/CultureSection');
const CultureQuestion = require('../models/CultureQuestion');
const CultureAttempt = require('../models/CultureAttempt');

/* ============================================================ Sections */

// GET /api/culture/sections   (any authenticated user)
exports.listSections = asyncHandler(async (req, res) => {
  // Annotate each section with its question count so empty sections
  // can be hidden from non-admins.
  const sections = await CultureSection.find().sort({ order: 1, createdAt: 1 });
  const counts = await CultureQuestion.aggregate([
    { $group: { _id: '$section', n: { $sum: 1 } } },
  ]);
  const countById = {};
  for (const c of counts) countById[String(c._id)] = c.n;

  const annotated = sections.map((s) => ({
    ...s.toObject(),
    questionCount: countById[String(s._id)] || 0,
  }));

  // Hide empty sections from parent/student — there's nothing to test.
  if (req.role === 'parent' || req.role === 'student') {
    return res.json(annotated.filter((s) => s.questionCount > 0));
  }
  res.json(annotated);
});

// POST /api/culture/sections   (admin)
exports.createSection = asyncHandler(async (req, res) => {
  const s = await CultureSection.create(req.body);
  res.status(201).json(s);
});

// PUT /api/culture/sections/:id
exports.updateSection = asyncHandler(async (req, res) => {
  const s = await CultureSection.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!s) { res.status(404); throw new Error('Section not found'); }
  res.json(s);
});

// DELETE /api/culture/sections/:id
// Cascades: drop questions in this section so we don't leave orphans.
exports.removeSection = asyncHandler(async (req, res) => {
  const s = await CultureSection.findByIdAndDelete(req.params.id);
  if (!s) { res.status(404); throw new Error('Section not found'); }
  await CultureQuestion.deleteMany({ section: s._id });
  res.json({ message: 'Section removed' });
});

/* =========================================================== Questions */

// GET /api/culture/questions?section=<id>   (admin)
exports.listQuestions = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.section) filter.section = req.query.section;
  const items = await CultureQuestion.find(filter).sort({ createdAt: -1 });
  res.json(items);
});

// POST /api/culture/questions
exports.createQuestion = asyncHandler(async (req, res) => {
  const payload = { ...req.body, createdBy: req.user._id };
  const q = await CultureQuestion.create(payload);
  res.status(201).json(q);
});

// PUT /api/culture/questions/:id
exports.updateQuestion = asyncHandler(async (req, res) => {
  const q = await CultureQuestion.findByIdAndUpdate(req.params.id, req.body, {
    new: true, runValidators: true,
  });
  if (!q) { res.status(404); throw new Error('Question not found'); }
  res.json(q);
});

// DELETE /api/culture/questions/:id
exports.removeQuestion = asyncHandler(async (req, res) => {
  const q = await CultureQuestion.findByIdAndDelete(req.params.id);
  if (!q) { res.status(404); throw new Error('Question not found'); }
  res.json({ message: 'Question removed' });
});

/* ============================================================== Quiz flow */

/**
 * POST /api/culture/start
 * Body: { section, count }
 *
 * Picks `count` random questions from the section (or all if fewer exist),
 * strips `correctIndex` and `explanation` so the client can't cheat by
 * peeking at the JSON, and returns:
 *   { attemptDraft: <not persisted>, questions: [{_id, question, options}] }
 *
 * The draft itself is not stored — the attempt only persists after
 * submission. We return the question ids so the client can submit answers
 * positionally and so the server has an authoritative ordering on submit.
 */
exports.start = asyncHandler(async (req, res) => {
  if (req.role !== 'parent' && req.role !== 'student') {
    res.status(403); throw new Error('Forbidden');
  }
  const { section, count } = req.body || {};
  if (!section) { res.status(400); throw new Error('section required'); }
  const n = Math.max(1, Math.min(50, Number(count) || 10));

  const sectionDoc = await CultureSection.findById(section);
  if (!sectionDoc) { res.status(404); throw new Error('Section not found'); }

  // $sample for cheap random pick.
  const sampled = await CultureQuestion.aggregate([
    { $match: { section: sectionDoc._id } },
    { $sample: { size: n } },
  ]);

  if (sampled.length === 0) {
    res.status(400); throw new Error('No questions in this section');
  }

  // Strip the answer key before responding.
  const safe = sampled.map((q) => ({
    _id: q._id,
    question: q.question,
    options: q.options,
  }));

  res.json({
    section: sectionDoc,
    questions: safe,
  });
});

/**
 * POST /api/culture/submit
 * Body: { section, questions: [<id>], answers: [<index>] }
 *
 * Server re-fetches the questions to grade them — never trusts the client
 * to send the correct answer back. Stores the attempt, returns it with
 * the correct answers and explanations so the client can render the
 * results screen.
 */
exports.submit = asyncHandler(async (req, res) => {
  if (req.role !== 'parent' && req.role !== 'student') {
    res.status(403); throw new Error('Forbidden');
  }
  const { section, questions, answers } = req.body || {};
  if (!section || !Array.isArray(questions) || !Array.isArray(answers)) {
    res.status(400); throw new Error('section, questions[], answers[] required');
  }
  if (questions.length !== answers.length) {
    res.status(400); throw new Error('questions and answers length mismatch');
  }

  // Pull the canonical questions in one go.
  const docs = await CultureQuestion.find({ _id: { $in: questions } });
  const byId = {};
  for (const q of docs) byId[String(q._id)] = q;

  let correctCount = 0;
  const detail = []; // for the response only

  for (let i = 0; i < questions.length; i++) {
    const qid = String(questions[i]);
    const q = byId[qid];
    if (!q) {
      // The id was bogus — count as wrong, no detail
      detail.push({ _id: qid, valid: false });
      continue;
    }
    const chosen = Number.isInteger(answers[i]) ? answers[i] : -1;
    const isCorrect = chosen === q.correctIndex;
    if (isCorrect) correctCount += 1;

    detail.push({
      _id: q._id,
      valid: true,
      question: q.question,
      options: q.options,
      chosen,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      isCorrect,
    });
  }

  const attempt = await CultureAttempt.create({
    userKind: req.role,
    user: req.user._id,
    section,
    questions,
    answers,
    correctCount,
    total: questions.length,
  });

  res.status(201).json({
    attempt,
    detail,
    correctCount,
    total: questions.length,
  });
});

/**
 * GET /api/culture/attempts/me
 * The taker's attempt history, most recent first.
 */
exports.myAttempts = asyncHandler(async (req, res) => {
  if (req.role !== 'parent' && req.role !== 'student') {
    res.status(403); throw new Error('Forbidden');
  }
  const items = await CultureAttempt.find({
    userKind: req.role,
    user: req.user._id,
  })
    .populate('section', 'name icon color')
    .sort({ createdAt: -1 })
    .limit(20);
  res.json(items);
});
