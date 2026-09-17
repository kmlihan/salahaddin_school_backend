const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/lessonController');

router.use(protect);

router.get('/', allow('admin', 'teacher', 'student'), ctrl.list);
router.get('/:id', allow('admin', 'teacher', 'student'), ctrl.getOne);
router.post('/', allow('admin', 'teacher'), ctrl.create);
router.post('/:id/copy', allow('admin', 'teacher'), ctrl.copy);
router.put('/:id', allow('admin', 'teacher'), ctrl.update);
router.delete('/:id', allow('admin', 'teacher'), ctrl.remove);

module.exports = router;
