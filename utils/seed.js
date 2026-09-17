/**
 * Seed script. Run with `npm run seed`.
 * Creates a default admin (idempotent) and a handful of demo records so the
 * UI has something to render on first boot.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const Admin = require('../models/Admin');
const Teacher = require('../models/Teacher');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const News = require('../models/News');
const generatePassword = require('./generatePassword');

async function run() {
  await connectDB();

  // Default admin
  let admin = await Admin.findOne({ email: 'admin@school.com' });
  if (!admin) {
    admin = await Admin.create({
      firstName: 'Site',
      lastName: 'Admin',
      email: 'admin@school.com',
      password: 'admin12345',
      phone: '+32 000 000 000',
    });
    console.log('Created admin: admin@school.com / admin12345');
  } else {
    console.log('Admin already exists');
  }

  // Sample teacher
  let teacher = await Teacher.findOne({ email: 'teacher@school.com' });
  if (!teacher) {
    teacher = await Teacher.create({
      firstName: 'Yusuf',
      lastName: 'Al-Khatib',
      email: 'teacher@school.com',
      password: generatePassword('Yusuf', 'Al-Khatib'),
      phone: '+32 111 111 111',
      hourlyRate: 30,
    });
    console.log(`Created teacher: teacher@school.com / ${generatePassword('Yusuf', 'Al-Khatib')}`);
  }

  // Sample parent
  let parent = await Parent.findOne({ email: 'parent@school.com' });
  if (!parent) {
    parent = await Parent.create({
      firstName: 'Amina',
      lastName: 'Hassan',
      email: 'parent@school.com',
      password: generatePassword('Amina', 'Hassan'),
      phone: '+32 222 222 222',
    });
    console.log(`Created parent: parent@school.com / ${generatePassword('Amina', 'Hassan')}`);
  }

  // Sample student
  let student = await Student.findOne({ email: 'student@school.com' });
  if (!student) {
    student = await Student.create({
      firstName: 'Omar',
      lastName: 'Hassan',
      email: 'student@school.com',
      password: generatePassword('Omar', 'Hassan'),
      parent: parent._id,
      level: 'A',
      gender: 'male',
      paidAmount: 0,
    });
    console.log(`Created student: student@school.com / ${generatePassword('Omar', 'Hassan')}`);
  }

  // Sample news
  const newsCount = await News.countDocuments();
  if (newsCount === 0) {
    await News.create({
      title: {
        en: 'Welcome to Salah al-Din School',
        ar: 'مرحبا بكم في مدرسة صلاح الدين',
        nl: 'Welkom bij Salah al-Din school',
      },
      blocks: [
        {
          type: 'text',
          order: 0,
          size: '100',
          content: {
            en: 'We are delighted to welcome new students for the upcoming year.',
            ar: 'يسعدنا أن نرحب بالطلاب الجدد للعام الدراسي القادم.',
            nl: 'Wij verwelkomen graag nieuwe leerlingen voor het komende schooljaar.',
          },
        },
      ],
      author: admin._id,
      published: true,
    });
    console.log('Created sample news');
  }

  console.log('Seed complete.');
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
