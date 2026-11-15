-- Migration 004: Read-Only Role for Vercel Web App (SELECT only)
DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'web_readonly') THEN
      CREATE ROLE web_readonly WITH LOGIN PASSWORD 'change_me_in_neon_console';
   END IF;
END
$$;

GRANT CONNECT ON DATABASE postgres TO web_readonly;
GRANT USAGE ON SCHEMA public TO web_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO web_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO web_readonly;

