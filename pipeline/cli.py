import argparse
import sys
import json
from pipeline.config import RETENTION_YEARS, MIN_SESSIONS_FLOOR, EQUITY_PARQUET_PATH
from pipeline.trim import trim_equity_parquet
from pipeline.workflow import run_daily_workflow

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

    args = parser.parse_args()

    if args.command == "trim":
        try:
            result = trim_equity_parquet(parquet_path=args.path, retention_years=args.years, min_sessions_floor=args.floor)
            print(json.dumps(result, indent=2))
        except Exception as e:
            print(f"Error executing trim: {e}", file=sys.stderr)
            sys.exit(1)
    elif args.command == "daily":
        try:
            result = run_daily_workflow(parquet_path=args.path)
            print(json.dumps(result, indent=2))
        except Exception as e:
            print(f"Error executing daily workflow: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()

