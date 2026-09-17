const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/teacherAttendanceController');

router.use(protect);

router.get('/', allow('admin'), ctrl.byDate);
router.get('/range', allow('admin'), ctrl.byRange);
router.post('/bulk', allow('admin'), ctrl.bulkUpsert);

module.exports = router;
