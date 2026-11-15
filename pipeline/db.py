import os
import glob
import time
import logging
from typing import Optional
import psycopg2
from psycopg2.extras import execute_batch, execute_values
from dotenv import load_dotenv

load_dotenv(".env")

logger = logging.getLogger("pipeline.db")

DATABASE_URL = os.environ.get("DATABASE_URL")

def get_connection(db_url: Optional[str] = None, max_retries: int = 3, initial_delay: float = 1.0):
    """
    Connects to PostgreSQL with automatic retry and backoff.
    Crucial for Neon serverless free tier which may take a few seconds to wake from idle sleep.
    """
    url = db_url or DATABASE_URL
    if not url:
        raise ValueError("DATABASE_URL is not set.")

    last_err = None
    delay = initial_delay
    for attempt in range(1, max_retries + 1):
        try:
            conn = psycopg2.connect(url)
            return conn
        except psycopg2.OperationalError as e:
            last_err = e
            logger.warning(
                f"Neon DB connection attempt {attempt}/{max_retries} failed (Neon may be waking from sleep): {e}. "
                f"Retrying in {delay:.1f}s..."
            )
            time.sleep(delay)
            delay *= 2
        except Exception as e:
            last_err = e
            logger.warning(f"DB connection attempt {attempt}/{max_retries} failed: {e}. Retrying in {delay:.1f}s...")
            time.sleep(delay)
            delay *= 2

    raise RuntimeError(f"Failed to connect to Neon PostgreSQL after {max_retries} attempts: {last_err}")

def run_migrations(conn=None, migrations_dir: Optional[str] = None):
    """
    Runs versioned SQL migrations tracked in schema_migrations table.
    """
    close_conn = False
    if conn is None:
        conn = get_connection()
        close_conn = True

    if migrations_dir is None:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        migrations_dir = os.path.join(base_dir, "migrations")

    try:
        with conn.cursor() as cur:
            # Ensure schema_migrations table exists
            cur.execute("""
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    applied_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            cur.execute("SELECT version FROM schema_migrations;")
            applied_versions = {row[0] for row in cur.fetchall()}
        conn.commit()

        sql_files = sorted(glob.glob(os.path.join(migrations_dir, "*.sql")))
        applied_count = 0

        for sql_file in sql_files:
            basename = os.path.basename(sql_file)
            # Expect format: 001_initial_schema.sql
            version_str = basename.split("_")[0]
            try:
                version = int(version_str)
            except ValueError:
                logger.warning(f"Skipping migration file with invalid version prefix: {basename}")
                continue

            if version in applied_versions:
                continue

            logger.info(f"Applying migration {version}: {basename}...")
            with open(sql_file, "r", encoding="utf-8") as f:
                sql_content = f.read()

            with conn.cursor() as cur:
                cur.execute(sql_content)
                cur.execute(
                    "INSERT INTO schema_migrations (version, name) VALUES (%s, %s);",
                    (version, basename)
                )
            conn.commit()
            applied_versions.add(version)
            applied_count += 1
            logger.info(f"Migration {version} ({basename}) applied successfully.")

        if applied_count == 0:
            logger.info("Schema migrations up to date (no pending migrations).")
        else:
            logger.info(f"Successfully applied {applied_count} new migration(s).")

    finally:
        if close_conn:
            conn.close()

def init_db(db_url: Optional[str] = None):
    """Runs all database migrations up to date."""
    conn = get_connection(db_url)
    try:
        run_migrations(conn)
    finally:
        conn.close()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()
