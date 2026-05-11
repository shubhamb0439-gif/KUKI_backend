require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profiles');
const employeeRoutes = require('./routes/employees');
const attendanceRoutes = require('./routes/attendance');
const wageRoutes = require('./routes/wages');
const adminRoutes = require('./routes/admin');
const messageRoutes = require('./routes/messages');
const qrTransactionRoutes = require('./routes/qr-transactions');
const queryRoutes = require('./routes/query');
const rpcRoutes = require('./routes/rpc');
const storageRoutes = require('./routes/storage');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://wonderful-coast-0dc3fda00.7.azurestaticapps.net',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting - protect auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many requests, please try again later' },
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRoutes);
app.use('/profiles', profileRoutes);
app.use('/employees', employeeRoutes);
app.use('/attendance', attendanceRoutes);
app.use('/wages', wageRoutes);
app.use('/admin', adminRoutes);
app.use('/messages', messageRoutes);
app.use('/qr-transactions', qrTransactionRoutes);
app.use('/query', queryRoutes);
app.use('/rpc', rpcRoutes);
app.use('/storage', storageRoutes);

// Health check (Azure App Service uses this)
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kuki API running on port ${PORT}`);
});
