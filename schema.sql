-- ============================================================
-- Kuki App - Azure SQL Schema
-- Run this in Azure SQL Database (kuki-db-prod)
-- ============================================================

-- ─── PROFILES ────────────────────────────────────────────────
CREATE TABLE profiles (
  id                      UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  email                   NVARCHAR(255) UNIQUE NULL,
  phone                   NVARCHAR(50) UNIQUE NULL,
  name                    NVARCHAR(255) NOT NULL,
  role                    NVARCHAR(50) NOT NULL CHECK (role IN ('employer', 'employee', 'admin')),
  password_hash           NVARCHAR(255) NULL,
  profile_photo           NVARCHAR(500) NULL,
  account_type            NVARCHAR(50) NULL,
  account_tier            NVARCHAR(50) NULL DEFAULT 'free',
  subscription_plan       NVARCHAR(50) NULL DEFAULT 'free',
  subscription_status     NVARCHAR(50) NULL DEFAULT 'inactive',
  subscription_expires_at DATETIMEOFFSET NULL,
  trial_ends_at           DATETIMEOFFSET NULL,
  payment_method_added    BIT DEFAULT 0,
  max_employees           INT DEFAULT 3,
  can_track_attendance    BIT DEFAULT 0,
  can_access_full_statements BIT DEFAULT 0,
  profession              NVARCHAR(255) NULL,
  job_status              NVARCHAR(50) NULL,
  show_status_ring        BIT DEFAULT 0,
  ads_enabled             BIT DEFAULT 1,
  ad_level                NVARCHAR(50) NULL,
  language_preference     NVARCHAR(10) DEFAULT 'en',
  last_login_at           DATETIMEOFFSET NULL,
  created_at              DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at              DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── EMPLOYEES ───────────────────────────────────────────────
CREATE TABLE employees (
  id              UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id         UNIQUEIDENTIFIER NULL REFERENCES profiles(id) ON DELETE SET NULL,
  employer_id     UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  employment_type NVARCHAR(50) DEFAULT 'full_time'
                  CHECK (employment_type IN ('full_time', 'part_time', 'contract')),
  wage_amount     DECIMAL(18,2) DEFAULT 0,
  wage_type       NVARCHAR(50) DEFAULT 'monthly'
                  CHECK (wage_type IN ('monthly', 'daily', 'hourly', 'contract')),
  start_date      DATE NULL,
  end_date        DATE NULL,
  status          NVARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes           NVARCHAR(MAX) NULL,
  created_at      DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at      DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── ATTENDANCE ───────────────────────────────────────────────
CREATE TABLE attendance (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id),
  date        DATE NOT NULL,
  clock_in    DATETIMEOFFSET NULL,
  clock_out   DATETIMEOFFSET NULL,
  hours_worked DECIMAL(8,2) NULL,
  location    NVARCHAR(500) NULL,
  qr_scan     BIT DEFAULT 0,
  is_manual   BIT DEFAULT 0,
  notes       NVARCHAR(MAX) NULL,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── WAGES ────────────────────────────────────────────────────
CREATE TABLE wages (
  id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id  UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id),
  amount       DECIMAL(18,2) NOT NULL,
  period_start DATE NULL,
  period_end   DATE NULL,
  status       NVARCHAR(50) DEFAULT 'pending'
               CHECK (status IN ('pending', 'paid', 'cancelled')),
  notes        NVARCHAR(MAX) NULL,
  created_at   DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at   DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── LOANS ────────────────────────────────────────────────────
CREATE TABLE employee_loans (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id),
  amount      DECIMAL(18,2) NOT NULL,
  description NVARCHAR(MAX) NULL,
  status      NVARCHAR(50) DEFAULT 'active'
              CHECK (status IN ('active', 'repaid', 'foreclosed')),
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── BONUSES ──────────────────────────────────────────────────
CREATE TABLE employee_bonuses (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id),
  amount      DECIMAL(18,2) NOT NULL,
  description NVARCHAR(MAX) NULL,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── STATEMENTS ───────────────────────────────────────────────
CREATE TABLE statements (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id     UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  employer_id UNIQUEIDENTIFIER NULL REFERENCES profiles(id),
  period      NVARCHAR(50) NULL,
  data        NVARCHAR(MAX) NULL, -- JSON blob of statement data
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── JOB ROLES ────────────────────────────────────────────────
CREATE TABLE job_roles (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  name        NVARCHAR(255) NOT NULL,
  description NVARCHAR(MAX) NULL,
  is_active   BIT DEFAULT 1,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── JOB POSTINGS ─────────────────────────────────────────────
CREATE TABLE job_postings (
  id              UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employer_id     UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  title           NVARCHAR(255) NOT NULL,
  description     NVARCHAR(MAX) NULL,
  location        NVARCHAR(255) NULL,
  wage            NVARCHAR(100) NULL,
  employment_type NVARCHAR(50) NULL,
  job_role_id     UNIQUEIDENTIFIER NULL REFERENCES job_roles(id),
  status          NVARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'closed', 'draft')),
  created_at      DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at      DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── JOB APPLICATIONS ─────────────────────────────────────────
CREATE TABLE job_applications (
  id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  job_id       UNIQUEIDENTIFIER NOT NULL REFERENCES job_postings(id),
  applicant_id UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  status       NVARCHAR(50) DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at   DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at   DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── MESSAGES ─────────────────────────────────────────────────
CREATE TABLE messages (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  sender_id   UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  receiver_id UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  content     NVARCHAR(MAX) NOT NULL,
  is_read     BIT DEFAULT 0,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── ADVERTISEMENTS ───────────────────────────────────────────
CREATE TABLE advertisements (
  id               UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  title            NVARCHAR(255) NOT NULL,
  description      NVARCHAR(MAX) NULL,
  video_url        NVARCHAR(500) NOT NULL,
  brand_name       NVARCHAR(255) NOT NULL,
  rate_per_display DECIMAL(18,4) DEFAULT 0,
  currency         NVARCHAR(10) DEFAULT 'USD',
  is_active        BIT DEFAULT 1,
  created_at       DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at       DATETIMEOFFSET DEFAULT GETUTCDATE()
);

CREATE TABLE ad_impressions (
  id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  ad_id      UNIQUEIDENTIFIER NOT NULL REFERENCES advertisements(id),
  user_id    UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  viewed_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── SUBSCRIPTION TRANSACTIONS ────────────────────────────────
CREATE TABLE subscription_transactions (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id     UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  plan        NVARCHAR(50) NOT NULL,
  amount      DECIMAL(18,2) NOT NULL,
  currency    NVARCHAR(10) DEFAULT 'USD',
  status      NVARCHAR(50) DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  payment_ref NVARCHAR(255) NULL,
  notes       NVARCHAR(MAX) NULL,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── LOGIN LOGS ───────────────────────────────────────────────
CREATE TABLE login_logs (
  id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id      UNIQUEIDENTIFIER NULL REFERENCES profiles(id) ON DELETE SET NULL,
  email        NVARCHAR(255) NULL,
  phone        NVARCHAR(50) NULL,
  name         NVARCHAR(255) NULL,
  account_type NVARCHAR(50) NULL,
  login_time   DATETIMEOFFSET DEFAULT GETUTCDATE(),
  user_agent   NVARCHAR(MAX) NULL,
  device_type  NVARCHAR(50) NULL,
  login_method NVARCHAR(50) NULL
);

-- ─── OTP (for later when SMS is ready) ───────────────────────
CREATE TABLE otp_verifications (
  id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  phone      NVARCHAR(50) NOT NULL,
  otp_code   NVARCHAR(10) NOT NULL,
  expires_at DATETIMEOFFSET NOT NULL,
  verified   BIT DEFAULT 0,
  attempts   INT DEFAULT 0,
  created_at DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── INDEXES (performance) ────────────────────────────────────
CREATE INDEX idx_employees_employer ON employees(employer_id);
CREATE INDEX idx_employees_user ON employees(user_id);
CREATE INDEX idx_attendance_employee ON attendance(employee_id);
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_wages_employee ON wages(employee_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_receiver ON messages(receiver_id);
CREATE INDEX idx_login_logs_user ON login_logs(user_id);
CREATE INDEX idx_ad_impressions_ad ON ad_impressions(ad_id);
