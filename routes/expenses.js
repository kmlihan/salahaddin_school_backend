const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/expenseController');

router.use(protect);

router.get('/', allow('admin'), ctrl.list);
router.post('/', allow('admin'), ctrl.create);
router.put('/:id', allow('admin'), ctrl.update);
router.delete('/:id', allow('admin'), ctrl.remove);

module.exports = router;
