-- ============================================================
-- Migration 014: Create feedback and waitlist tables
-- ============================================================

-- Feedback table
CREATE TABLE IF NOT EXISTS feedback (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  type VARCHAR(20) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  user_id CHAR(36),
  email VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback (type);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback (created_at);

-- Waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  role VARCHAR(50),
  source VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist (email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist (created_at);
