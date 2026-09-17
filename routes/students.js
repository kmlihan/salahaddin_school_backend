const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/studentController');

router.use(protect);

router.get('/upcoming-birthdays', allow('admin', 'teacher'), ctrl.upcomingBirthdays);
router.get('/', allow('admin', 'teacher', 'parent'), ctrl.list);
router.get('/:id', allow('admin', 'teacher', 'parent', 'student'), ctrl.getOne);
router.post('/', allow('admin'), ctrl.create);
router.put('/:id', allow('admin'), ctrl.update);
router.delete('/:id', allow('admin'), ctrl.remove);

module.exports = router;
