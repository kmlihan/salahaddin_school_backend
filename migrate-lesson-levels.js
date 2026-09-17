require('dotenv').config();
const mongoose = require('mongoose');
const Lesson = require('./models/Lesson');

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  const lessons = await Lesson.find({});
  for (const lesson of lessons) {
    let changed = false;
    if (!lesson.levels || lesson.levels.length === 0) {
      lesson.levels = lesson.level ? [lesson.level] : ['A'];
      changed = true;
    }
    if (changed) {
      await lesson.save();
      console.log(`Migrated lesson ${lesson._id}: levels = ${lesson.levels}`);
    }
  }
  console.log('Migration complete.');
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(console.error);