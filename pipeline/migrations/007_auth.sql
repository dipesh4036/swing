-- Migration 007: App Users and Login Attempts for Authentication
CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT now(),
  success BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON login_attempts(email, ip_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_cleanup ON login_attempts(attempted_at);

-- Role grants for web_readonly
DO $$
BEGIN
   IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      GRANT SELECT ON TABLE app_users TO web_readonly;
      GRANT SELECT, INSERT, DELETE ON TABLE login_attempts TO web_readonly;
      GRANT USAGE, SELECT ON SEQUENCE login_attempts_id_seq TO web_readonly;
   END IF;
END
$$;

