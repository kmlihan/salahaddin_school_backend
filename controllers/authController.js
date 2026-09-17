const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const Admin = require('../models/Admin');
const Teacher = require('../models/Teacher');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const generateToken = require('../utils/generateToken');
const { sendMailMulti } = require('../utils/mail');

const MODELS = [
  ['admin', Admin],
  ['teacher', Teacher],
  ['parent', Parent],
  ['student', Student],
];

const RESET_TTL_MINUTES = 60;

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function findUserByEmailAcrossRoles(email) {
  // Returns the first match across the four collections, with its role.
  return (async () => {
    const lower = String(email).toLowerCase();
    for (const [role, Model] of MODELS) {
      const user = await Model.findOne({ email: lower });
      if (user) return { role, user };
    }
    return null;
  })();
}

/**
 * POST /api/auth/login
 */
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password required');
  }

  const found = await findUserByEmailAcrossRoles(email);
  if (found && (await found.user.matchPassword(password))) {
    const safe = found.user.toObject();
    delete safe.password;
    delete safe.resetTokenHash;
    delete safe.resetTokenExpires;
    return res.json({
      token: generateToken(found.user._id, found.role),
      role: found.role,
      user: safe,
    });
  }

  res.status(401);
  throw new Error('Invalid credentials');
});

/**
 * GET /api/auth/me
 */
exports.me = asyncHandler(async (req, res) => {
  res.json({ role: req.role, user: req.user });
});

/**
 * POST /api/auth/reset-password
 * Authenticated change — user supplies current and new password.
 */
exports.resetPassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400);
    throw new Error('Current and new password are required');
  }
  if (String(newPassword).length < 6) {
    res.status(400);
    throw new Error('New password must be at least 6 characters');
  }

  const Model = req.user.constructor;
  const fresh = await Model.findById(req.user._id);
  if (!(await fresh.matchPassword(currentPassword))) {
    res.status(401);
    throw new Error('Current password is incorrect');
  }

  fresh.password = newPassword;
  await fresh.save();
  res.json({ message: 'Password updated' });
});

/**
 * PUT /api/auth/profile
 */
exports.updateProfile = asyncHandler(async (req, res) => {
  const Model = req.user.constructor;
  const allowed = ['firstName', 'lastName', 'email', 'phone', 'photo'];
  const update = {};
  for (const k of allowed) if (k in req.body) update[k] = req.body[k];

  const updated = await Model.findByIdAndUpdate(req.user._id, update, {
    new: true,
    runValidators: true,
  }).select('-password -resetTokenHash -resetTokenExpires');

  res.json({ role: req.role, user: updated });
});

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 *
 * Always responds 200 with the same generic message regardless of whether
 * an account exists — this prevents the endpoint from being used to probe
 * which addresses are registered.
 */
exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const generic = { message: 'If an account exists for that address, a reset link has been sent.' };

  if (!email) return res.json(generic);

  const found = await findUserByEmailAcrossRoles(email);
  if (!found) return res.json(generic);

  const { user } = found;

  // Generate a 32-byte random token. Store the hash, send the raw value.
  const raw = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = hashToken(raw);
  user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
  await user.save();

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const link = `${clientUrl}/reset-password?token=${raw}&email=${encodeURIComponent(email)}`;

  await sendMailMulti({
    to: email,
    subject: {
      ar: 'مدرسة صلاح الدين — إعادة تعيين كلمة المرور',
      en: 'Salah al-Din — password reset',
      nl: 'Salah al-Din — wachtwoord opnieuw instellen',
    },
    text: {
      ar:
        `لقد تلقّينا طلبًا لإعادة تعيين كلمة المرور الخاصة بك.\n\n` +
        `اضغط على الرابط التالي خلال ${RESET_TTL_MINUTES} دقيقة لاختيار كلمة مرور جديدة:\n` +
        `${link}\n\n` +
        `إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.`,
      en:
        `We received a request to reset your password.\n\n` +
        `Click the link below within ${RESET_TTL_MINUTES} minutes to set a new password:\n` +
        `${link}\n\n` +
        `If you didn't request this, you can ignore this email.`,
      nl:
        `We hebben een verzoek ontvangen om uw wachtwoord opnieuw in te stellen.\n\n` +
        `Klik binnen ${RESET_TTL_MINUTES} minuten op onderstaande link om een nieuw wachtwoord te kiezen:\n` +
        `${link}\n\n` +
        `Als u dit niet hebt aangevraagd, kunt u deze e-mail negeren.`,
    },
  });

  res.json(generic);
});

/**
 * POST /api/auth/reset-password-with-token
 * Body: { email, token, newPassword }
 */
exports.resetPasswordWithToken = asyncHandler(async (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) {
    res.status(400); throw new Error('email, token and newPassword are required');
  }
  if (String(newPassword).length < 6) {
    res.status(400); throw new Error('New password must be at least 6 characters');
  }

  const found = await findUserByEmailAcrossRoles(email);
  if (!found) { res.status(400); throw new Error('Invalid or expired reset link'); }

  const { user } = found;
  if (
    !user.resetTokenHash ||
    !user.resetTokenExpires ||
    user.resetTokenExpires.getTime() < Date.now() ||
    user.resetTokenHash !== hashToken(token)
  ) {
    res.status(400); throw new Error('Invalid or expired reset link');
  }

  user.password = newPassword;
  user.resetTokenHash = '';
  user.resetTokenExpires = null;
  await user.save();

  res.json({ message: 'Password updated. You can now sign in.' });
});
