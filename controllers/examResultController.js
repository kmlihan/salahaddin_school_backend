const asyncHandler = require('express-async-handler');
const { childrenScope, childScope } = require('../utils/parentScope');
const ExamResult = require('../models/ExamResult');
const Student = require('../models/Student');

/**
 * GET /api/exam-results
 * List exam results across the school. Visibility:
 *   - admin & teacher: all results
 *   - parent: results for their own children
 *   - student: their own results
 *
 * Optional query params:
 *   ?student=<id>   filter by student
 *   ?exam=<id>      filter by exam
 */
exports.listAll = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.student) filter.student = req.query.student;
  if (req.query.exam) filter.exam = req.query.exam;

  if (req.role === 'student') {
    filter.student = req.user._id;
  } else if (req.role === 'parent') {
    // Restrict to results whose student is a child of this parent.
    const children = await Student.find(childrenScope(req.user._id)).select('_id');
    const ids = children.map((c) => c._id);
    if (filter.student) {
      // If they passed ?student, ensure it's one of theirs.
      if (!ids.find((id) => String(id) === String(filter.student))) {
        return res.json([]);
      }
    } else {
      filter.student = { $in: ids };
    }
  }

  const results = await ExamResult.find(filter)
    .populate('exam', 'title section level type passingGrade')
    .populate('student', 'firstName lastName level photo gender')
    .sort({ submittedAt: -1 });

  res.json(results);
});

/**
 * GET /api/exam-results/student/:id
 * Visibility:
 *   - admin & teacher: any student
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

  const results = await ExamResult.find({ student: studentId })
    .populate('exam', 'title section level type passingGrade')
    .sort({ submittedAt: -1 });

  res.json(results);
});

/**
 * GET /api/exam-results/:id
 * Detailed view of a single result, with the underlying exam (including
 * correct answers, since this is post-submission).
 */
exports.getOne = asyncHandler(async (req, res) => {
  const result = await ExamResult.findById(req.params.id)
    .populate('exam')
    .populate('student', 'firstName lastName level parent');

  if (!result) { res.status(404); throw new Error('Result not found'); }

  if (req.role === 'student' && String(result.student._id) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }
  if (req.role === 'parent' && String(result.student.parent) !== String(req.user._id)) {
    res.status(403); throw new Error('Forbidden');
  }
  res.json(result);
});

/**
 * PUT /api/exam-results/:id/feedback
 * Body: { questionId, feedback }   (teacher / admin only)
 * Allows teachers to add written feedback to specific answers.
 */
exports.addFeedback = asyncHandler(async (req, res) => {
  const { questionId, feedback } = req.body;
  const result = await ExamResult.findById(req.params.id);
  if (!result) { res.status(404); throw new Error('Result not found'); }

  const ans = result.answers.find((a) => String(a.questionId) === String(questionId));
  if (!ans) { res.status(404); throw new Error('Answer not found'); }
  ans.feedback = feedback;
  await result.save();
  res.json(result);
});
