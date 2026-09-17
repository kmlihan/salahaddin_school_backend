const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

router.post('/login', ctrl.login);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password-with-token', ctrl.resetPasswordWithToken);
router.get('/me', protect, ctrl.me);
router.post('/reset-password', protect, ctrl.resetPassword);
router.put('/profile', protect, ctrl.updateProfile);

module.exports = router;
