const express = require('express');
const router = express.Router();
const { protect, allow } = require('../middleware/auth');
const ctrl = require('../controllers/parentController');

router.use(protect);

// Parent's own children — must come before /:id
router.get('/me/children', allow('parent'), ctrl.myChildren);

router.get('/', allow('admin'), ctrl.list);
router.get('/:id', allow('admin', 'parent'), ctrl.getOne);
router.post('/', allow('admin'), ctrl.create);
router.put('/:id', allow('admin'), ctrl.update);
router.delete('/:id', allow('admin'), ctrl.remove);

module.exports = router;
