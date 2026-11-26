import argparse
import sys
import os
import json
import logging
from pipeline.config import RETENTION_YEARS, MIN_SESSIONS_FLOOR, EQUITY_PARQUET_PATH
from pipeline.trim import trim_equity_parquet
from pipeline.workflow import run_daily_workflow, run_weekly_refetch
from pipeline.store import download_parquet_store, upload_parquet_store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("pipeline.cli")

def main():
    parser = argparse.ArgumentParser(description="Market Breadth Pipeline CLI")
    subparsers = parser.add_subparsers(dest="command", help="Pipeline commands")

    # Trim command
    trim_parser = subparsers.add_parser("trim", help="Trim equity_ohlcv.parquet to rolling RETENTION_YEARS")
    trim_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")
    trim_parser.add_argument("--years", type=int, default=RETENTION_YEARS, help="Retention years")
    trim_parser.add_argument("--floor", type=int, default=MIN_SESSIONS_FLOOR, help="Min sessions floor")

    # Daily workflow command
    daily_parser = subparsers.add_parser("daily", help="Run full daily workflow with trim as final step")
    daily_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")
    daily_parser.add_argument("--tokens-limit", type=int, default=None, help="Limit number of tokens for testing")
    daily_parser.add_argument("--source", default=None, choices=["bhavcopy", "angel"], help="Equities source")

    # Catch-up workflow command
    catchup_parser = subparsers.add_parser("catch-up", help="Run catch-up workflow for missed or post-settlement sessions")
    catchup_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")
    catchup_parser.add_argument("--tokens-limit", type=int, default=None, help="Limit number of tokens for testing")
    catchup_parser.add_argument("--source", default=None, choices=["bhavcopy", "angel"], help="Equities source")

    # Weekly full re-fetch command
    weekly_parser = subparsers.add_parser("weekly", help="Run weekly full re-fetch with retention limit")
    weekly_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")
    weekly_parser.add_argument("--years", type=int, default=RETENTION_YEARS, help="Retention years (default 3)")
    weekly_parser.add_argument("--tokens-limit", type=int, default=None, help="Limit number of tokens for testing")

    # Backfill command
    backfill_parser = subparsers.add_parser("backfill", help="Run initial 3-year backfill across instruments, indices, macro, constituents, and equities")
    backfill_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")
    backfill_parser.add_argument("--years", type=int, default=RETENTION_YEARS, help="Retention years (default 3)")
    backfill_parser.add_argument("--tokens-limit", type=int, default=None, help="Limit number of tokens for testing")

    # Recompute-all command
    recompute_parser = subparsers.add_parser("recompute-all", help="Recompute indicators & aggregates from parquet and publish without candle re-fetch")
    recompute_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")

    # Test connection command
    test_parser = subparsers.add_parser("test-connection", help="Test SmartAPI login and one candle fetch")

    # Verify Bhavcopy command
    verify_bhav_parser = subparsers.add_parser("verify-bhavcopy", help="Verify latest Bhavcopy download against SmartAPI sample")
    verify_bhav_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")

    # Dedupe store command (Item 7b)
    dedupe_parser = subparsers.add_parser("dedupe-store", help="Dedupe symbols across multiple tokens due to series moves (EQ<->BE)")
    dedupe_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")

    # Load Industry Map command (I1)
    load_ind_parser = subparsers.add_parser("load-industry-map", help="Upsert data/industry_map.csv into stock_industry")
    load_ind_parser.add_argument("--path", default="data/industry_map.csv", help="Path to industry_map.csv")

    # Sync Market Cap command (I1)
    sync_mcap_parser = subparsers.add_parser("sync-mcap", help="Sync latest market cap & issue size from PR bhavcopy zip into stock_mcap")
    sync_mcap_parser.add_argument("--date", default=None, help="Target date YYYY-MM-DD (defaults to latest)")

    # Backfill Industry command (I2)
    backfill_ind_parser = subparsers.add_parser("backfill-industry", help="Backfill daily_industry_breadth and index for last 250 sessions")
    backfill_ind_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")

    # Classification import command (C1)
    cls_imp_parser = subparsers.add_parser("classification-import", help="One-time idempotent import of local classification CSVs into DB")
    cls_imp_parser.add_argument("--file", required=True, help="Path to local master CSV")
    cls_imp_parser.add_argument("--overrides", default=None, help="Path to local overrides CSV")
    cls_imp_parser.add_argument("--symbol-changes", default=None, help="Path to local symbol changes CSV")
    cls_imp_parser.add_argument("--delisted", default=None, help="Path to local delisted CSV")
    cls_imp_parser.add_argument("--dry-run", action="store_true", help="Preview import counts without writing to DB")

    # Classification manual set / remove / export commands (C1)
    cls_set_parser = subparsers.add_parser("classification-set", help="Set manual 4-level classification override for a symbol")
    cls_set_parser.add_argument("symbol", help="NSE symbol")
    cls_set_parser.add_argument("--macro", required=True)
    cls_set_parser.add_argument("--sector", required=True)
    cls_set_parser.add_argument("--industry", required=True)
    cls_set_parser.add_argument("--basic", required=True)
    cls_set_parser.add_argument("--note", default="manual cli")

    cls_rem_parser = subparsers.add_parser("classification-remove", help="Mark a symbol as delisted in classification")
    cls_rem_parser.add_argument("symbol", help="NSE symbol")
    cls_rem_parser.add_argument("--reason", default="manual remove")

    cls_exp_parser = subparsers.add_parser("classification-export", help="Export DB classification to local CSV backup")
    cls_exp_parser.add_argument("--out", default="data/classification_backup.csv")

    # Classification incremental sync command
    cls_sync_parser = subparsers.add_parser("classification-sync", help="Incrementally sync missing/new NSE 4-level classifications")
    cls_sync_parser.add_argument("--dry-run", action="store_true", help="Preview queue without writing or calling per-stock APIs")
    cls_sync_parser.add_argument("--retry-missing", action="store_true", help="Include previously failed/unmapped symbols in queue")
    cls_sync_parser.add_argument("--refresh", default=None, help="Force refresh a specific symbol")

    # Industry RS_STS recompute command
    ind_recompute_parser = subparsers.add_parser("industry-recompute", help="Recompute latest 4-level industry RS_STS snapshot from Parquet")
    ind_recompute_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")

    # Industry RS_STS backfill command
    ind_backfill_parser = subparsers.add_parser("industry-backfill", help="Backfill 4-level daily_industry_strength history from Parquet")
    ind_backfill_parser.add_argument("--path", default=EQUITY_PARQUET_PATH, help="Path to parquet file")
    ind_backfill_parser.add_argument("--from", dest="from_date", default=None, help="Start date YYYY-MM-DD")
    ind_backfill_parser.add_argument("--sessions", type=int, default=125, help="Trailing sessions to backfill if --from omitted")

    args = parser.parse_args()

    if args.command == "trim":
        try:
            result = trim_equity_parquet(parquet_path=args.path, retention_years=args.years, min_sessions_floor=args.floor)
            print(json.dumps(result, indent=2))
        except Exception as e:
            print(f"Error executing trim: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command in ("daily", "catch-up"):
        if getattr(args, "source", None):
            os.environ["DAILY_SOURCE"] = args.source
        logger.info(f"Executing '{args.command}' workflow (source={os.environ.get('DAILY_SOURCE', 'bhavcopy')})...")
        try:
            from pipeline.db import init_db
            logger.info("Ensuring database migrations are up to date...")
            init_db()
        except Exception as e:
            logger.warning(f"Database migration notice during {args.command}: {e}")

        download_parquet_store(args.path)
        try:
            result = run_daily_workflow(parquet_path=args.path, tokens_limit=args.tokens_limit)
            success = (result.get("status") in ("success", "partial"))
            upload_parquet_store(args.path, job_succeeded=success)
            print(json.dumps(result, indent=2))
            if not success:
                sys.exit(1)
        except Exception as e:
            upload_parquet_store(args.path, job_succeeded=False)
            print(f"Error executing {args.command} workflow: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "weekly":
        logger.info("Executing 'weekly' workflow...")
        try:
            from pipeline.db import init_db
            logger.info("Ensuring database migrations are up to date...")
            init_db()
        except Exception as e:
            logger.warning(f"Database migration notice during weekly: {e}")

        download_parquet_store(args.path)
        try:
            result = run_weekly_refetch(retention_years=args.years, parquet_path=args.path, tokens_limit=args.tokens_limit)
            success = (result.get("status") in ("success", "partial"))
            upload_parquet_store(args.path, job_succeeded=success)
            print(json.dumps(result, indent=2))
            if not success:
                sys.exit(1)
        except Exception as e:
            upload_parquet_store(args.path, job_succeeded=False)
            print(f"Error executing weekly workflow: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "backfill":
        logger.info(f"Executing 'backfill' workflow (retention={args.years}y)...")
        try:
            from pipeline.db import init_db
            logger.info("Ensuring database migrations are up to date...")
            init_db()
        except Exception as e:
            logger.warning(f"Database migration notice during backfill: {e}")

        download_parquet_store(args.path)
        try:
            result = run_weekly_refetch(retention_years=args.years, parquet_path=args.path, tokens_limit=args.tokens_limit)
            success = (result.get("status") == "success")
            upload_parquet_store(args.path, job_succeeded=success)
            print(json.dumps(result, indent=2))
            if not success:
                sys.exit(1)
        except Exception as e:
            upload_parquet_store(args.path, job_succeeded=False)
            print(f"Error executing backfill workflow: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "recompute-all":
        logger.info("Executing 'recompute-all' breadth indicators and publish...")
        try:
            from pipeline.db import init_db
            logger.info("Ensuring database migrations are up to date...")
            init_db()
        except Exception as e:
            logger.warning(f"Database migration notice during recompute-all: {e}")

        if not os.path.exists(args.path):
            download_parquet_store(args.path)
        try:
            from pipeline.compute import compute_and_publish_all
            res = compute_and_publish_all(parquet_path=args.path)
            if not res:
                logger.error("Compute and publish failed.")
                sys.exit(1)
            print(json.dumps({"status": "success", "command": "recompute-all"}, indent=2))
        except Exception as e:
            print(f"Error executing recompute-all: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "test-connection":
        logger.info("Executing 'test-connection' to verify SmartAPI access...")
        try:
            import datetime
            from pipeline.smartapi_client import get_smartapi_client
            client = get_smartapi_client()
            if not client.session_data:
                logger.error("SmartAPI authentication failed.")
                sys.exit(1)
            logger.info("SmartAPI authentication successful.")

            to_date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
            from_date = (datetime.datetime.now() - datetime.timedelta(days=10)).strftime("%Y-%m-%d %H:%M")
            candles = client.get_candle_data("NSE", "11536", "ONE_DAY", from_date, to_date)
            client.logout()

            if not candles:
                logger.error("SmartAPI candle call returned empty response.")
                sys.exit(1)

            logger.info(f"SmartAPI candle test passed! Received {len(candles)} candles. Latest candle: {candles[-1]}")
            print(json.dumps({
                "status": "success",
                "message": "SmartAPI login and candle fetch successful",
                "candles_count": len(candles),
                "latest_candle_time": candles[-1][0]
            }, indent=2))
        except Exception as e:
            print(f"Error testing SmartAPI connection: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "verify-bhavcopy":
        logger.info("Executing 'verify-bhavcopy' command...")
        try:
            download_parquet_store(args.path)
            from pipeline.bhavcopy import verify_bhavcopy_command
            code = verify_bhavcopy_command(parquet_path=args.path)
            sys.exit(code)
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

    elif args.command == "dedupe-store":
        logger.info("Executing 'dedupe-store' command...")
        try:
            download_parquet_store(args.path)
            from pipeline.dedupe import dedupe_equity_parquet
            res = dedupe_equity_parquet(parquet_path=args.path)
            upload_parquet_store(args.path, job_succeeded=True)
            print(json.dumps(res, indent=2))
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

    elif args.command == "load-industry-map":
        logger.info("Executing 'load-industry-map' command...")
        try:
            from pipeline.industries import load_industry_map
            res = load_industry_map(csv_path=args.path)
            sys.exit(0 if res.get("status") == "success" else 1)
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

    elif args.command == "sync-mcap":
        logger.info("Executing 'sync-mcap' command...")
        try:
            from datetime import datetime
            from pipeline.industries import sync_stock_mcap
            t_date = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else None
            res = sync_stock_mcap(target_date=t_date)
            print(json.dumps(res, indent=2))
            sys.exit(0 if res.get("status") == "success" else 1)
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

    elif args.command == "backfill-industry":
        logger.info("Executing 'backfill-industry' command...")
        try:
            download_parquet_store(args.path)
            from pipeline.industries import backfill_industry_metrics
            res = backfill_industry_metrics(parquet_path=args.path)
            print(json.dumps(res, indent=2))
            sys.exit(0 if res.get("status") == "success" else 1)
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

    elif args.command == "classification-import":
        logger.info("Executing 'classification-import' command...")
        try:
            from pipeline.classification import import_classification_file
            res = import_classification_file(
                file_path=args.file,
                overrides_path=args.overrides,
                symbol_changes_path=args.symbol_changes,
                delisted_path=args.delisted,
                dry_run=args.dry_run,
            )
            print(json.dumps(res, indent=2))
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

    elif args.command == "classification-set":
        try:
            from pipeline.classification import set_classification_override
            res = set_classification_override(
                args.symbol, args.macro, args.sector, args.industry, args.basic, note=args.note
            )
            print(json.dumps(res, indent=2))
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "classification-remove":
        try:
            from pipeline.classification import mark_classification_delisted
            res = mark_classification_delisted(args.symbol, reason=args.reason)
            print(json.dumps(res, indent=2))
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "classification-export":
        try:
            from pipeline.classification import export_classification_csv
            res = export_classification_csv(out_path=args.out)
            print(json.dumps(res, indent=2))
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "classification-sync":
        logger.info("Executing 'classification-sync' command...")
        try:
            from pipeline.classification import sync_classification
            res = sync_classification(
                dry_run=args.dry_run,
                retry_missing=args.retry_missing,
                refresh_symbol=args.refresh,
                fetch_equity=True,
            )
            print(json.dumps(res, indent=2))
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

    elif args.command == "industry-recompute":
        logger.info("Executing 'industry-recompute' command...")
        try:
            download_parquet_store(args.path)
            import pandas as pd
            from pipeline.industry_publish import run_industry_strength_job
            df = pd.read_parquet(args.path)
            res = run_industry_strength_job(df)
            print(json.dumps(res, indent=2))
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

    elif args.command == "industry-backfill":
        logger.info("Executing 'industry-backfill' command...")
        try:
            download_parquet_store(args.path)
            import pandas as pd
            from pipeline.industry_publish import backfill_industry_strength
            df = pd.read_parquet(args.path)
            res = backfill_industry_strength(
                df,
                from_date=args.from_date,
                sessions=args.sessions,
            )
            print(json.dumps(res, indent=2))
        except Exception as e:
            import traceback
            traceback.print_exc()
            sys.exit(1)

    else:
        parser.print_help()

if __name__ == "__main__":
    main()
