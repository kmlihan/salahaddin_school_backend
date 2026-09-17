const nodemailer = require('nodemailer');

let transporter = null;
let usingConsole = false;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST) {
    usingConsole = true;
    transporter = {
      sendMail: async (opts) => {
        // Stand-in: print the email so dev can read it from the server log.
        console.log('\n----- [DEV MAIL] -----');
        console.log('To:      ', opts.to);
        console.log('Subject: ', opts.subject);
        console.log('Text:    \n' + (opts.text || ''));
        console.log('----- [/DEV MAIL] -----\n');
        return { messageId: 'dev-' + Date.now() };
      },
    };
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

/** Single-language send. Kept for any callers that don't need translations. */
async function sendMail({ to, subject, text, html }) {
  try {
    const tr = getTransporter();
    const from = process.env.MAIL_FROM || 'Salah al-Din <no-reply@school.local>';
    await tr.sendMail({ from, to, subject, text, html });
    return true;
  } catch (err) {
    console.error('Mail send failed:', err.message);
    return false;
  }
}

/**
 * Trilingual send. Caller passes:
 *
 *   {
 *     to: 'parent@example.com',
 *     subject: { ar: '...', en: '...', nl: '...' },
 *     text:    { ar: '...', en: '...', nl: '...' },
 *   }
 *
 * The recipient gets ONE message that contains all three versions, in the
 * order Arabic → English → Dutch, separated by a clear divider line and a
 * language label so the reader can find their language quickly. The Subject
 * line concatenates all three with a separator. If a language is missing
 * from the input, that section is simply skipped.
 *
 * We send to all recipients regardless of which language they prefer — we
 * don't store a language preference per user yet, and being trilingual on
 * outgoing email is what the requirement asks for.
 */
async function sendMailMulti({ to, subject, text }) {
  // The order of the languages in the email body. Arabic first because it's
  // the school's primary language; English second as the lingua-franca
  // fallback; Dutch third for local context.
  const ORDER = [
    { code: 'ar', label: 'العربية' },
    { code: 'en', label: 'English' },
    { code: 'nl', label: 'Nederlands' },
  ];

  const safe = (obj, code) =>
    obj && typeof obj === 'object' ? (obj[code] || '').trim() : (obj || '').toString().trim();

  // Subject: join the three (in the order above), filtering out empty ones.
  const subjectParts = ORDER.map((l) => safe(subject, l.code)).filter(Boolean);
  const finalSubject = subjectParts.join(' · ') || 'Salah al-Din';

  // Body: each section gets a header line with the language label, then
  // a divider between sections.
  const DIVIDER = '\n────────────────────\n';
  const sections = ORDER
    .map((l) => {
      const body = safe(text, l.code);
      if (!body) return null;
      return `[${l.label}]\n${body}`;
    })
    .filter(Boolean);

  const finalText = sections.join(DIVIDER);

  return sendMail({ to, subject: finalSubject, text: finalText });
}

module.exports = {
  sendMail,
  sendMailMulti,
  isUsingConsoleTransport: () => usingConsole,
};
