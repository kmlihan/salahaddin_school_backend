const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/cultureController');

router.use(protect);

// Sections
router.get('/sections',         allow('admin', 'teacher', 'parent', 'student'), ctrl.listSections);
router.post('/sections',        allow('admin'), ctrl.createSection);
router.put('/sections/:id',     allow('admin'), ctrl.updateSection);
router.delete('/sections/:id',  allow('admin'), ctrl.removeSection);

// Questions (admin manages)
router.get('/questions',        allow('admin'), ctrl.listQuestions);
router.post('/questions',       allow('admin'), ctrl.createQuestion);
router.put('/questions/:id',    allow('admin'), ctrl.updateQuestion);
router.delete('/questions/:id', allow('admin'), ctrl.removeQuestion);

// Quiz flow (parent + student)
router.post('/start',           allow('parent', 'student'), ctrl.start);
router.post('/submit',          allow('parent', 'student'), ctrl.submit);
router.get('/attempts/me',      allow('parent', 'student'), ctrl.myAttempts);

module.exports = router;
