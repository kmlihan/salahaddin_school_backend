const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/registrationController');

// Public: submit a new request
router.post('/', ctrl.submit);

// Admin
router.get('/', protect, allow('admin'), ctrl.list);
router.post('/:id/approve', protect, allow('admin'), ctrl.approve);
router.post('/:id/reject', protect, allow('admin'), ctrl.reject);
router.delete('/:id', protect, allow('admin'), ctrl.remove);

module.exports = router;
