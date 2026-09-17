const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/homeworkController');

router.use(protect);

router.put('/:id', allow('admin', 'teacher'), ctrl.updateSubmission);

module.exports = router;
