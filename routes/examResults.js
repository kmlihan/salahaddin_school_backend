const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/examResultController');

router.use(protect);

router.get('/', allow('admin', 'teacher', 'parent', 'student'), ctrl.listAll);
router.get('/student/:id', allow('admin', 'teacher', 'parent', 'student'), ctrl.byStudent);
router.get('/:id', allow('admin', 'teacher', 'parent', 'student'), ctrl.getOne);
router.put('/:id/feedback', allow('admin', 'teacher'), ctrl.addFeedback);

module.exports = router;
