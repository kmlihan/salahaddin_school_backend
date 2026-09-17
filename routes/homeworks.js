const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/homeworkController');

router.use(protect);

// CRUD
router.get('/', allow('admin', 'teacher', 'student', 'parent'), ctrl.list);
router.get('/:id', allow('admin', 'teacher', 'student', 'parent'), ctrl.getOne);
router.post('/', allow('admin', 'teacher'), ctrl.create);
router.put('/:id', allow('admin', 'teacher'), ctrl.update);
router.delete('/:id', allow('admin', 'teacher'), ctrl.remove);

// Student submission
router.post('/:id/submit', allow('student'), ctrl.submit);

// Parent note (for book reading)
router.post('/:id/parent-note', allow('parent'), ctrl.parentNote);

// Teacher / admin review
router.get('/:id/submissions', allow('admin', 'teacher'), ctrl.listSubmissions);

// Single (homework, student) submission lookup — used by parents to read
// their children's submission, by students to read their own, by teachers/
// admins for any. The controller enforces per-role limits.
router.get('/:id/submission', allow('admin', 'teacher', 'parent', 'student'), ctrl.getOneSubmission);

module.exports = router;
