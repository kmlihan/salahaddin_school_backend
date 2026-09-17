const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/noteController');

router.use(protect);

router.get('/student/:id', allow('admin', 'teacher', 'parent', 'student'), ctrl.byStudent);
router.post('/', allow('admin', 'teacher', 'parent'), ctrl.create);
router.put('/:id', allow('admin', 'teacher', 'parent'), ctrl.update);
router.delete('/:id', allow('admin', 'teacher', 'parent'), ctrl.remove);

module.exports = router;
