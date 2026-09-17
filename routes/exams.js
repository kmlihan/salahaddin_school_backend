const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/examController');

router.use(protect);

router.get('/', allow('admin', 'teacher', 'student', 'parent'), ctrl.list);
router.get('/:id', allow('admin', 'teacher', 'student', 'parent'), ctrl.getOne);
router.post('/', allow('admin', 'teacher'), ctrl.create);
router.put('/:id', allow('admin', 'teacher'), ctrl.update);
router.delete('/:id', allow('admin', 'teacher'), ctrl.remove);

router.post('/:id/submit', allow('student'), ctrl.submit);

module.exports = router;
