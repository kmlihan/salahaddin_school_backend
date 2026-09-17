const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/calendarController');

router.use(protect);

router.get('/',                allow('admin', 'teacher', 'parent', 'student'), ctrl.list);
router.post('/',               allow('admin'),   ctrl.create);
router.put('/:id',             allow('admin'),   ctrl.update);
router.delete('/:id',          allow('admin'),   ctrl.remove);
router.post('/:id/respond',    allow('teacher'), ctrl.respond);

module.exports = router;
