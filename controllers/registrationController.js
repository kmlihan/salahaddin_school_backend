const asyncHandler = require('express-async-handler');
const RegistrationRequest = require('../models/RegistrationRequest');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const generatePassword = require('../utils/generatePassword');
const { sendMail, sendMailMulti } = require('../utils/mail');

/**
 * POST /api/registrations    (public)
 * Body shape:
 *   {
 *     parent:  { firstName, lastName, email, phone },
 *     student: {
 *       firstName, lastName, email, gender, level?,
 *       birthDate, phone?, emergencyPhone,
 *       address: { street, houseNumber, city, postalCode, country }
 *     },
 *     message
 *   }
 *
 * Creates a pending registration request. Sends:
 *   - confirmation email to the parent (we received your request)
 *   - notification email to admins (someone wants to register) — using the
 *     ADMIN_NOTIFY_EMAIL env var if set, otherwise skipped.
 */

// Validation helpers shared with the studentController guard. Kept inline
// rather than imported so the registration submission has no dependency
// on the admin-create path.
const EMAIL_RX  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RX  = /^\+[1-9]\d{6,14}$/; // E.164
const POSTAL_RX = /^[A-Za-z0-9 \-]{2,12}$/;

function bad(res, msg) { res.status(400); throw new Error(msg); }

function levelFromAge(birthDate) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  if (age >= 6 && age <= 12) return 'A';
  if (age >= 13 && age <= 16) return 'B';
  return null;
}

exports.submit = asyncHandler(async (req, res) => {
  const { parent, student, message } = req.body || {};
  if (!parent || !student) {
    bad(res, 'Parent and student details are required');
  }

  /* ----- parent validation ----- */
  if (!parent.firstName || !parent.lastName) bad(res, 'Parent first and last names are required');
  if (!parent.email || !EMAIL_RX.test(String(parent.email))) bad(res, 'Invalid parent email');
  if (parent.phone && !PHONE_RX.test(String(parent.phone))) {
    bad(res, 'Invalid parent phone (use international format, e.g. +32…)');
  }

  /* ----- student validation ----- */
  if (!student.firstName || !student.lastName) bad(res, 'Student first and last names are required');
  if (!student.email || !EMAIL_RX.test(String(student.email))) bad(res, 'Invalid student email');
  if (!['male', 'female'].includes(student.gender)) bad(res, 'gender must be male or female');

  // birthDate is required and drives auto-level for ages 6–16. C and D
  // are skill-based — if the form sent one, accept it; otherwise we need
  // a derivable A/B from age.
  if (!student.birthDate) bad(res, 'Student birthdate is required');
  const bd = new Date(student.birthDate);
  if (isNaN(bd.getTime())) bad(res, 'Invalid student birthdate');
  if (bd.getTime() > Date.now()) bad(res, 'Birthdate cannot be in the future');

  let level = student.level;
  if (!level) level = levelFromAge(bd);
  if (!level || !['A', 'B', 'C', 'D'].includes(level)) {
    bad(res, 'Could not determine level from age — please pick one (C: reads Arabic, D: reads Quran)');
  }

  // emergencyPhone is required, the student's own phone is optional.
  if (!student.emergencyPhone || !PHONE_RX.test(String(student.emergencyPhone))) {
    bad(res, 'A valid emergency phone is required (international format, e.g. +32…)');
  }
  if (student.phone && !PHONE_RX.test(String(student.phone))) {
    bad(res, 'Invalid student phone (international format, e.g. +32…)');
  }

  // address — every field required
  const addr = student.address || {};
  for (const f of ['street', 'houseNumber', 'city', 'postalCode', 'country']) {
    if (!String(addr[f] || '').trim()) bad(res, `address.${f} is required`);
  }
  if (!POSTAL_RX.test(String(addr.postalCode))) bad(res, 'Invalid postal code format');

  /* ----- duplicate-email guards ----- */
  const existingParent = await Parent.findOne({ email: String(parent.email).toLowerCase() });
  if (existingParent) bad(res, 'A parent with that email already exists.');
  const existingStudent = await Student.findOne({ email: String(student.email).toLowerCase() });
  if (existingStudent) bad(res, 'A student with that email already exists.');

  const dup = await RegistrationRequest.findOne({
    status: 'pending',
    'parent.email': String(parent.email).toLowerCase(),
  });
  if (dup) bad(res, 'A pending request for this parent email already exists.');

  /* ----- create the request ----- */
  const reqDoc = await RegistrationRequest.create({
    parent: {
      firstName: parent.firstName,
      lastName:  parent.lastName,
      email:     parent.email,
      phone:     parent.phone || '',
    },
    student: {
      firstName:      student.firstName,
      lastName:       student.lastName,
      email:          student.email,
      level,
      gender:         student.gender,
      birthDate:      bd,
      phone:          student.phone || '',
      emergencyPhone: student.emergencyPhone,
      address: {
        street:      addr.street.trim(),
        houseNumber: addr.houseNumber.trim(),
        city:        addr.city.trim(),
        postalCode:  addr.postalCode.trim(),
        country:     addr.country.trim(),
      },
    },
    message: message || '',
  });

  // Confirmation to the parent (trilingual)
  await sendMailMulti({
    to: parent.email,
    subject: {
      ar: 'مدرسة صلاح الدين — تم استلام طلب التسجيل',
      en: 'Salah al-Din — registration received',
      nl: 'Salah al-Din — inschrijving ontvangen',
    },
    text: {
      ar:
        `مرحبًا ${parent.firstName}،\n\n` +
        `لقد تلقّينا طلب تسجيلك للطالب ${student.firstName} ${student.lastName}.\n` +
        `سيقوم فريقنا بمراجعته والتواصل معك قريبًا بنتيجة الطلب.\n\n` +
        `— مدرسة صلاح الدين`,
      en:
        `Hello ${parent.firstName},\n\n` +
        `We've received your registration request for ${student.firstName} ${student.lastName}.\n` +
        `Our team will review it and contact you with the outcome shortly.\n\n` +
        `— Salah al-Din school`,
      nl:
        `Hallo ${parent.firstName},\n\n` +
        `We hebben uw inschrijvingsverzoek voor ${student.firstName} ${student.lastName} ontvangen.\n` +
        `Ons team beoordeelt uw aanvraag en neemt binnenkort contact met u op over de uitkomst.\n\n` +
        `— Salah al-Din school`,
    },
  });

  // Optional admin heads-up
  if (process.env.ADMIN_NOTIFY_EMAIL) {
    await sendMail({
      to: process.env.ADMIN_NOTIFY_EMAIL,
      subject: 'New registration request',
      text:
        `A new registration is pending review:\n\n` +
        `Parent:  ${parent.firstName} ${parent.lastName} <${parent.email}>\n` +
        `Student: ${student.firstName} ${student.lastName} <${student.email}> · level ${student.level}\n` +
        `Message: ${message || '—'}\n`,
    });
  }

  res.status(201).json({ id: reqDoc._id, message: 'Registration request submitted.' });
});

/**
 * GET /api/registrations    (admin)
 * Query: ?status=pending|approved|rejected   (defaults to pending)
 */
exports.list = asyncHandler(async (req, res) => {
  const status = req.query.status || 'pending';
  const items = await RegistrationRequest.find({ status }).sort({ createdAt: -1 });
  res.json(items);
});

/**
 * POST /api/registrations/:id/approve    (admin)
 * Creates the Parent and Student records, sends both their auto-generated
 * passwords, marks the request as approved.
 */
exports.approve = asyncHandler(async (req, res) => {
  const reqDoc = await RegistrationRequest.findById(req.params.id);
  if (!reqDoc) { res.status(404); throw new Error('Request not found'); }
  if (reqDoc.status !== 'pending') {
    res.status(400); throw new Error('Request has already been decided');
  }

  // Re-check duplicates at decision time (race-safety).
  if (await Parent.findOne({ email: reqDoc.parent.email })) {
    res.status(400); throw new Error('A parent with that email already exists.');
  }
  if (await Student.findOne({ email: reqDoc.student.email })) {
    res.status(400); throw new Error('A student with that email already exists.');
  }

  const parentPassword = generatePassword(reqDoc.parent.firstName, reqDoc.parent.lastName);
  const parent = await Parent.create({
    firstName: reqDoc.parent.firstName,
    lastName: reqDoc.parent.lastName,
    email: reqDoc.parent.email,
    phone: reqDoc.parent.phone,
    password: parentPassword,
  });

  const studentPassword = generatePassword(reqDoc.student.firstName, reqDoc.student.lastName);
  const student = await Student.create({
    firstName:      reqDoc.student.firstName,
    lastName:       reqDoc.student.lastName,
    email:          reqDoc.student.email,
    // New multi-parent shape. Registration creates one guardian; admin
    // can add the other parent later via the student edit form. The
    // pre('save') hook keeps the legacy `parent` field synced to this
    // first entry for back-compat.
    parents: [{ parent: parent._id, relationship: 'guardian' }],
    level:          reqDoc.student.level,
    gender:         reqDoc.student.gender,
    birthDate:      reqDoc.student.birthDate,
    phone:          reqDoc.student.phone || '',
    emergencyPhone: reqDoc.student.emergencyPhone || '',
    address: {
      street:      reqDoc.student.address?.street      || '',
      houseNumber: reqDoc.student.address?.houseNumber || '',
      city:        reqDoc.student.address?.city        || '',
      postalCode:  reqDoc.student.address?.postalCode  || '',
      country:     reqDoc.student.address?.country     || '',
    },
    password: studentPassword,
  });

  reqDoc.status = 'approved';
  reqDoc.decidedAt = new Date();
  reqDoc.decidedBy = req.user?._id;
  await reqDoc.save();

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

  // Email the parent — includes both sets of credentials, in three languages.
  await sendMailMulti({
    to: parent.email,
    subject: {
      ar: 'مدرسة صلاح الدين — تم قبول التسجيل',
      en: 'Salah al-Din — registration approved',
      nl: 'Salah al-Din — inschrijving goedgekeurd',
    },
    text: {
      ar:
        `مرحبًا ${parent.firstName}،\n\n` +
        `تم قبول طلب التسجيل. يمكنك تسجيل الدخول من هنا: ${clientUrl}/login\n\n` +
        `حساب ولي الأمر\n` +
        `  البريد الإلكتروني: ${parent.email}\n` +
        `  كلمة المرور:      ${parentPassword}\n\n` +
        `حساب الطالب (للطالب ${student.firstName})\n` +
        `  البريد الإلكتروني: ${student.email}\n` +
        `  كلمة المرور:      ${studentPassword}\n\n` +
        `يرجى تغيير كلمتي المرور بعد أول تسجيل دخول.\n\n` +
        `— مدرسة صلاح الدين`,
      en:
        `Hello ${parent.firstName},\n\n` +
        `Your registration has been approved. You can sign in at ${clientUrl}/login\n\n` +
        `Parent account\n` +
        `  Email:    ${parent.email}\n` +
        `  Password: ${parentPassword}\n\n` +
        `Student account (for ${student.firstName})\n` +
        `  Email:    ${student.email}\n` +
        `  Password: ${studentPassword}\n\n` +
        `Please change your passwords after the first login.\n\n` +
        `— Salah al-Din school`,
      nl:
        `Hallo ${parent.firstName},\n\n` +
        `Uw inschrijving is goedgekeurd. U kunt inloggen op ${clientUrl}/login\n\n` +
        `Ouderaccount\n` +
        `  E-mail:     ${parent.email}\n` +
        `  Wachtwoord: ${parentPassword}\n\n` +
        `Leerlingaccount (voor ${student.firstName})\n` +
        `  E-mail:     ${student.email}\n` +
        `  Wachtwoord: ${studentPassword}\n\n` +
        `Wijzig de wachtwoorden alstublieft na de eerste keer inloggen.\n\n` +
        `— Salah al-Din school`,
    },
  });

  // Separate email to the student's address (if different).
  if (student.email !== parent.email) {
    await sendMailMulti({
      to: student.email,
      subject: {
        ar: 'مدرسة صلاح الدين — حساب الطالب الخاص بك',
        en: 'Salah al-Din — your student account',
        nl: 'Salah al-Din — uw leerlingaccount',
      },
      text: {
        ar:
          `مرحبًا ${student.firstName}،\n\n` +
          `أهلًا بك! تم إنشاء حسابك. يمكنك تسجيل الدخول من هنا: ${clientUrl}/login\n\n` +
          `  البريد الإلكتروني: ${student.email}\n` +
          `  كلمة المرور:      ${studentPassword}\n\n` +
          `يرجى تغيير كلمة المرور بعد أول تسجيل دخول.\n\n` +
          `— مدرسة صلاح الدين`,
        en:
          `Hello ${student.firstName},\n\n` +
          `Welcome! Your student account has been created. Sign in at ${clientUrl}/login\n\n` +
          `  Email:    ${student.email}\n` +
          `  Password: ${studentPassword}\n\n` +
          `Please change your password after the first login.\n\n` +
          `— Salah al-Din school`,
        nl:
          `Hallo ${student.firstName},\n\n` +
          `Welkom! Uw leerlingaccount is aangemaakt. Log in op ${clientUrl}/login\n\n` +
          `  E-mail:     ${student.email}\n` +
          `  Wachtwoord: ${studentPassword}\n\n` +
          `Wijzig uw wachtwoord alstublieft na de eerste keer inloggen.\n\n` +
          `— Salah al-Din school`,
      },
    });
  }

  res.json({ message: 'Approved', parentId: parent._id, studentId: student._id });
});

/**
 * POST /api/registrations/:id/reject    (admin)
 * Body: { reason }
 */
exports.reject = asyncHandler(async (req, res) => {
  const reqDoc = await RegistrationRequest.findById(req.params.id);
  if (!reqDoc) { res.status(404); throw new Error('Request not found'); }
  if (reqDoc.status !== 'pending') {
    res.status(400); throw new Error('Request has already been decided');
  }

  reqDoc.status = 'rejected';
  reqDoc.rejectionReason = req.body.reason || '';
  reqDoc.decidedAt = new Date();
  reqDoc.decidedBy = req.user?._id;
  await reqDoc.save();

  await sendMailMulti({
    to: reqDoc.parent.email,
    subject: {
      ar: 'مدرسة صلاح الدين — تحديث بشأن طلب التسجيل',
      en: 'Salah al-Din — registration update',
      nl: 'Salah al-Din — update over uw inschrijving',
    },
    text: {
      ar:
        `مرحبًا ${reqDoc.parent.firstName}،\n\n` +
        `شكرًا لاهتمامك بمدرستنا. للأسف، لا يمكننا متابعة طلب التسجيل في الوقت الحالي.\n` +
        (reqDoc.rejectionReason ? `\nالسبب: ${reqDoc.rejectionReason}\n` : '') +
        `\nإذا كنت تظن أن هذا خطأ، يرجى التواصل معنا.\n\n` +
        `— مدرسة صلاح الدين`,
      en:
        `Hello ${reqDoc.parent.firstName},\n\n` +
        `Thank you for your interest in our school. ` +
        `Unfortunately we are unable to proceed with your registration at this time.\n` +
        (reqDoc.rejectionReason ? `\nReason: ${reqDoc.rejectionReason}\n` : '') +
        `\nIf you believe this is a mistake, please contact us.\n\n` +
        `— Salah al-Din school`,
      nl:
        `Hallo ${reqDoc.parent.firstName},\n\n` +
        `Bedankt voor uw interesse in onze school. ` +
        `Helaas kunnen we uw inschrijving op dit moment niet verwerken.\n` +
        (reqDoc.rejectionReason ? `\nReden: ${reqDoc.rejectionReason}\n` : '') +
        `\nAls u denkt dat dit een vergissing is, neem dan contact met ons op.\n\n` +
        `— Salah al-Din school`,
    },
  });

  res.json({ message: 'Rejected' });
});

/**
 * DELETE /api/registrations/:id    (admin)
 * Hard-delete a request — useful for clearing out test data.
 */
exports.remove = asyncHandler(async (req, res) => {
  const r = await RegistrationRequest.findByIdAndDelete(req.params.id);
  if (!r) { res.status(404); throw new Error('Request not found'); }
  res.json({ message: 'Removed' });
});
