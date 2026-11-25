-- Migration 014: Grant UPDATE on login_attempts to web_readonly role
DO $$
BEGIN
   IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      GRANT UPDATE ON TABLE login_attempts TO web_readonly;
   END IF;
END
$$;
