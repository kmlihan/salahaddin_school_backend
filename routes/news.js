const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/newsController');

// Public
router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);

// Admin
router.post('/', protect, allow('admin'), ctrl.create);
router.put('/:id', protect, allow('admin'), ctrl.update);
router.delete('/:id', protect, allow('admin'), ctrl.remove);

module.exports = router;
