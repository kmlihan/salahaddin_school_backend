require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const connectDB = require('./config/db');
const { errorHandler, notFound } = require('./middleware/errorHandler');

connectDB();

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Static — uploaded media
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Salah al-Din API' }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/parents', require('./routes/parents'));
app.use('/api/students', require('./routes/students'));
app.use('/api/lessons', require('./routes/lessons'));
app.use('/api/exams', require('./routes/exams'));
app.use('/api/exam-results', require('./routes/examResults'));
app.use('/api/homeworks', require('./routes/homeworks'));
app.use('/api/homework-submissions', require('./routes/homeworkSubmissions'));
app.use('/api/news', require('./routes/news'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/teacher-attendance', require('./routes/teacherAttendance'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/registrations', require('./routes/registrations'));
app.use('/api/culture', require('./routes/culture'));

// 404 + errors
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Salah al-Din API listening on :${PORT}`));
