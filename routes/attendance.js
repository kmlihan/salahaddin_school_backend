const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/attendanceController');

router.use(protect);

router.get('/', allow('admin', 'teacher'), ctrl.byDate);
router.get('/range', allow('admin', 'teacher'), ctrl.byDateRange);
router.post('/', allow('admin', 'teacher'), ctrl.create);
router.post('/bulk', allow('admin', 'teacher'), ctrl.bulkUpsert);
router.get('/student/:id', allow('admin', 'teacher', 'parent', 'student'), ctrl.byStudent);
router.put('/:id', allow('admin', 'teacher'), ctrl.update);
router.delete('/:id', allow('admin'), ctrl.remove);

module.exports = router;
