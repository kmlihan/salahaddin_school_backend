const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/paymentController');

router.use(protect);

router.get('/preview-from-attendance', allow('admin'), ctrl.previewFromAttendance);
router.get('/', allow('admin', 'teacher'), ctrl.list);
router.get('/:id', allow('admin', 'teacher'), ctrl.getOne);
router.get('/:id/payslip', allow('admin', 'teacher'), ctrl.payslip);
router.post('/', allow('admin'), ctrl.create);
router.put('/:id', allow('admin'), ctrl.update);
router.delete('/:id', allow('admin'), ctrl.remove);

module.exports = router;
