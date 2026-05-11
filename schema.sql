-- ============================================================
-- Kuki App - Azure SQL Schema
-- Safe to re-run: all statements are idempotent
-- ============================================================

-- ─── PROFILES ────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'profiles')
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
  trial_used              BIT DEFAULT 0,
  trial_started_at        DATETIMEOFFSET NULL,
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
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employees')
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
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'attendance')
CREATE TABLE attendance (
  id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id  UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id),
  date         DATE NOT NULL,
  clock_in     DATETIMEOFFSET NULL,
  clock_out    DATETIMEOFFSET NULL,
  hours_worked DECIMAL(8,2) NULL,
  location     NVARCHAR(500) NULL,
  qr_scan      BIT DEFAULT 0,
  is_manual    BIT DEFAULT 0,
  notes        NVARCHAR(MAX) NULL,
  created_at   DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at   DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── WAGES ────────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'wages')
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
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_loans')
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
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_bonuses')
CREATE TABLE employee_bonuses (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id UNIQUEIDENTIFIER NOT NULL REFERENCES employees(id),
  amount      DECIMAL(18,2) NOT NULL,
  description NVARCHAR(MAX) NULL,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── STATEMENTS ───────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'statements')
CREATE TABLE statements (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id     UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  employer_id UNIQUEIDENTIFIER NULL REFERENCES profiles(id),
  period      NVARCHAR(50) NULL,
  data        NVARCHAR(MAX) NULL,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── JOB ROLES ────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'job_roles')
CREATE TABLE job_roles (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  name        NVARCHAR(255) NOT NULL,
  description NVARCHAR(MAX) NULL,
  is_active   BIT DEFAULT 1,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── JOB POSTINGS ─────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'job_postings')
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
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'job_applications')
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
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'messages')
CREATE TABLE messages (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  sender_id   UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  receiver_id UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  content     NVARCHAR(MAX) NOT NULL,
  is_read     BIT DEFAULT 0,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── ADVERTISEMENTS ───────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'advertisements')
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

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ad_impressions')
CREATE TABLE ad_impressions (
  id        UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  ad_id     UNIQUEIDENTIFIER NOT NULL REFERENCES advertisements(id),
  user_id   UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  viewed_at DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── SUBSCRIPTION TRANSACTIONS ────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'subscription_transactions')
CREATE TABLE subscription_transactions (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id     UNIQUEIDENTIFIER NOT NULL REFERENCES profiles(id),
  [plan]      NVARCHAR(50) NOT NULL,
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
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'login_logs')
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

-- ─── OTP ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'otp_verifications')
CREATE TABLE otp_verifications (
  id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  phone      NVARCHAR(50) NOT NULL,
  otp_code   NVARCHAR(10) NOT NULL,
  expires_at DATETIMEOFFSET NOT NULL,
  verified   BIT DEFAULT 0,
  attempts   INT DEFAULT 0,
  created_at DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── WAGE LOANS ──────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'wage_loans')
CREATE TABLE wage_loans (
  id                  UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id         UNIQUEIDENTIFIER NULL,
  employer_id         UNIQUEIDENTIFIER NULL,
  amount              DECIMAL(10,2) NULL,
  interest_rate       DECIMAL(5,2) DEFAULT 0,
  total_amount        DECIMAL(10,2) NULL,
  remaining_amount    DECIMAL(10,2) NULL,
  monthly_deduction   DECIMAL(10,2) NULL,
  repayment_amount    DECIMAL(10,2) NULL,
  repayment_frequency NVARCHAR(50) NULL,
  currency            NVARCHAR(10) DEFAULT 'USD',
  notes               NVARCHAR(MAX) NULL,
  status              NVARCHAR(50) NULL DEFAULT 'active',
  loan_date           DATETIMEOFFSET NULL,
  paid_amount         DECIMAL(10,2) DEFAULT 0,
  foreclosure_date    DATETIMEOFFSET NULL,
  qr_code             NVARCHAR(MAX) NULL,
  created_at          DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── WAGE BONUSES ────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'wage_bonuses')
CREATE TABLE wage_bonuses (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id UNIQUEIDENTIFIER NULL,
  employer_id UNIQUEIDENTIFIER NULL,
  type        NVARCHAR(50) NULL,
  category    NVARCHAR(50) NULL,
  amount      DECIMAL(10,2) NULL,
  currency    NVARCHAR(10) DEFAULT 'USD',
  reason      NVARCHAR(MAX) NULL,
  comment     NVARCHAR(MAX) NULL,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── WAGE CONTRACTS ──────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'wage_contracts')
CREATE TABLE wage_contracts (
  id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id  UNIQUEIDENTIFIER NULL,
  employer_id  UNIQUEIDENTIFIER NULL,
  amount       DECIMAL(10,2) NULL,
  currency     NVARCHAR(10) DEFAULT 'USD',
  description  NVARCHAR(MAX) NULL,
  payment_date DATE NULL,
  created_at   DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── WAGE STATEMENTS ─────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'wage_statements')
CREATE TABLE wage_statements (
  id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id  UNIQUEIDENTIFIER NULL,
  user_id      UNIQUEIDENTIFIER NULL,
  employer_id  UNIQUEIDENTIFIER NULL,
  type         NVARCHAR(50) NULL,
  amount       DECIMAL(10,2) NULL,
  description  NVARCHAR(MAX) NULL,
  period_start DATE NULL,
  period_end   DATE NULL,
  details      NVARCHAR(MAX) NULL,
  message      NVARCHAR(MAX) NULL,
  created_at   DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── QR TRANSACTIONS ─────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'qr_transactions')
CREATE TABLE qr_transactions (
  id               UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id      UNIQUEIDENTIFIER NULL,
  employer_id      UNIQUEIDENTIFIER NULL,
  transaction_type NVARCHAR(50) NULL,
  type             NVARCHAR(50) NULL,
  amount           DECIMAL(10,2) NULL,
  qr_code          NVARCHAR(500) NULL,
  status           NVARCHAR(50) NULL DEFAULT 'pending',
  metadata         NVARCHAR(MAX) NULL,
  created_at       DATETIMEOFFSET DEFAULT GETUTCDATE(),
  CONSTRAINT uq_qr_transactions_qr_code UNIQUE (qr_code)
);

-- ─── PLAN CHANGE REQUESTS ────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'plan_change_requests')
CREATE TABLE plan_change_requests (
  id             UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  user_id        UNIQUEIDENTIFIER NULL,
  current_plan   NVARCHAR(50) NULL,
  requested_plan NVARCHAR(50) NULL,
  reason         NVARCHAR(MAX) NULL,
  status         NVARCHAR(50) NULL DEFAULT 'pending',
  reviewed_at    DATETIMEOFFSET NULL,
  reviewed_by    UNIQUEIDENTIFIER NULL,
  created_at     DATETIMEOFFSET DEFAULT GETUTCDATE()
);

-- ─── EMPLOYEE RATINGS ────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_ratings')
CREATE TABLE employee_ratings (
  id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id UNIQUEIDENTIFIER NULL,
  employer_id UNIQUEIDENTIFIER NULL,
  rating      DECIMAL(3,1) NULL,
  comment     NVARCHAR(MAX) NULL,
  created_at  DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at  DATETIMEOFFSET NULL,
  CONSTRAINT uq_employee_ratings UNIQUE (employee_id, employer_id)
);

-- ─── EMPLOYEE WAGES ──────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'employee_wages')
CREATE TABLE employee_wages (
  id                    UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  employee_id           UNIQUEIDENTIFIER NULL,
  employer_id           UNIQUEIDENTIFIER NULL,
  monthly_wage          DECIMAL(10,2) DEFAULT 0,
  currency              NVARCHAR(10) DEFAULT 'USD',
  hourly_rate           DECIMAL(10,4) DEFAULT 0,
  working_hours_per_day DECIMAL(5,1) DEFAULT 8,
  total_working_days    INT DEFAULT 22,
  actual_hours_worked   DECIMAL(8,1) DEFAULT 0,
  final_payable         DECIMAL(10,2) DEFAULT 0,
  merits                DECIMAL(10,2) DEFAULT 0,
  demerits              DECIMAL(10,2) DEFAULT 0,
  advances              DECIMAL(10,2) DEFAULT 0,
  loan_deductions       DECIMAL(10,2) DEFAULT 0,
  created_at            DATETIMEOFFSET DEFAULT GETUTCDATE(),
  updated_at            DATETIMEOFFSET DEFAULT GETUTCDATE(),
  CONSTRAINT uq_employee_wages UNIQUE (employee_id, employer_id)
);

-- ─── ADD MISSING COLUMNS TO EXISTING TABLES ──────────────────

-- profiles: columns added after initial creation
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'trial_used')
  ALTER TABLE profiles ADD trial_used BIT DEFAULT 0;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'trial_started_at')
  ALTER TABLE profiles ADD trial_started_at DATETIMEOFFSET NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'profession')
  ALTER TABLE profiles ADD profession NVARCHAR(255) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'job_status')
  ALTER TABLE profiles ADD job_status NVARCHAR(50) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'show_status_ring')
  ALTER TABLE profiles ADD show_status_ring BIT DEFAULT 0;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'ad_level')
  ALTER TABLE profiles ADD ad_level NVARCHAR(50) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'language_preference')
  ALTER TABLE profiles ADD language_preference NVARCHAR(10) DEFAULT 'en';
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'last_login_at')
  ALTER TABLE profiles ADD last_login_at DATETIMEOFFSET NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'account_tier')
  ALTER TABLE profiles ADD account_tier NVARCHAR(50) NULL DEFAULT 'free';
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'subscription_plan')
  ALTER TABLE profiles ADD subscription_plan NVARCHAR(50) NULL DEFAULT 'free';
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'subscription_status')
  ALTER TABLE profiles ADD subscription_status NVARCHAR(50) NULL DEFAULT 'inactive';
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'subscription_expires_at')
  ALTER TABLE profiles ADD subscription_expires_at DATETIMEOFFSET NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'trial_ends_at')
  ALTER TABLE profiles ADD trial_ends_at DATETIMEOFFSET NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'payment_method_added')
  ALTER TABLE profiles ADD payment_method_added BIT DEFAULT 0;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'max_employees')
  ALTER TABLE profiles ADD max_employees INT DEFAULT 3;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'can_track_attendance')
  ALTER TABLE profiles ADD can_track_attendance BIT DEFAULT 0;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'can_access_full_statements')
  ALTER TABLE profiles ADD can_access_full_statements BIT DEFAULT 0;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'account_type')
  ALTER TABLE profiles ADD account_type NVARCHAR(50) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'profile_photo')
  ALTER TABLE profiles ADD profile_photo NVARCHAR(500) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'ads_enabled')
  ALTER TABLE profiles ADD ads_enabled BIT DEFAULT 1;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('profiles') AND name = 'updated_at')
  ALTER TABLE profiles ADD updated_at DATETIMEOFFSET DEFAULT GETUTCDATE();

-- job_applications
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('job_applications') AND name = 'updated_at')
  ALTER TABLE job_applications ADD updated_at DATETIMEOFFSET NULL;

-- wage_loans
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_loans') AND name = 'interest_rate')
  ALTER TABLE wage_loans ADD interest_rate DECIMAL(5,2) DEFAULT 0;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_loans') AND name = 'total_amount')
  ALTER TABLE wage_loans ADD total_amount DECIMAL(10,2) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_loans') AND name = 'remaining_amount')
  ALTER TABLE wage_loans ADD remaining_amount DECIMAL(10,2) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_loans') AND name = 'monthly_deduction')
  ALTER TABLE wage_loans ADD monthly_deduction DECIMAL(10,2) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_loans') AND name = 'currency')
  ALTER TABLE wage_loans ADD currency NVARCHAR(10) DEFAULT 'USD';
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_loans') AND name = 'loan_date')
  ALTER TABLE wage_loans ADD loan_date DATETIMEOFFSET NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_loans') AND name = 'paid_amount')
  ALTER TABLE wage_loans ADD paid_amount DECIMAL(10,2) DEFAULT 0;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_loans') AND name = 'foreclosure_date')
  ALTER TABLE wage_loans ADD foreclosure_date DATETIMEOFFSET NULL;

-- wage_bonuses
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_bonuses') AND name = 'category')
  ALTER TABLE wage_bonuses ADD category NVARCHAR(50) NULL;
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_bonuses') AND name = 'currency')
  ALTER TABLE wage_bonuses ADD currency NVARCHAR(10) DEFAULT 'USD';
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_bonuses') AND name = 'comment')
  ALTER TABLE wage_bonuses ADD comment NVARCHAR(MAX) NULL;

-- wage_contracts
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_contracts') AND name = 'currency')
  ALTER TABLE wage_contracts ADD currency NVARCHAR(10) DEFAULT 'USD';

-- wage_statements
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('wage_statements') AND name = 'message')
  ALTER TABLE wage_statements ADD message NVARCHAR(MAX) NULL;

-- qr_transactions
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('qr_transactions') AND name = 'transaction_type')
  ALTER TABLE qr_transactions ADD transaction_type NVARCHAR(50) NULL;

-- ─── INDEXES ─────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_employees_employer')
  CREATE INDEX idx_employees_employer ON employees(employer_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_employees_user')
  CREATE INDEX idx_employees_user ON employees(user_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_attendance_employee')
  CREATE INDEX idx_attendance_employee ON attendance(employee_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_attendance_date')
  CREATE INDEX idx_attendance_date ON attendance(date);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_wages_employee')
  CREATE INDEX idx_wages_employee ON wages(employee_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_messages_sender')
  CREATE INDEX idx_messages_sender ON messages(sender_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_messages_receiver')
  CREATE INDEX idx_messages_receiver ON messages(receiver_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_login_logs_user')
  CREATE INDEX idx_login_logs_user ON login_logs(user_id);
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_ad_impressions_ad')
  CREATE INDEX idx_ad_impressions_ad ON ad_impressions(ad_id);
