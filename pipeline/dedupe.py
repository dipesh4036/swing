import os
import shutil
import logging
from typing import Dict, Any, List, Optional
import pandas as pd
from pipeline.config import EQUITY_PARQUET_PATH

logger = logging.getLogger("pipeline.dedupe")

def dedupe_equity_parquet(
    parquet_path: str = EQUITY_PARQUET_PATH,
    conn=None
) -> Dict[str, Any]:
    """
    Dedupes equity parquet store when a stock exists under multiple tokens due to series moves (e.g. EQ <-> BE).
    For every symbol with more than one token in the Parquet:
    - Queries `instruments` table for currently active token (is_active = True).
    - If neither/both, prefers token with the latest trade_date.
    - Re-keys older token's unique dates to the winning token, drops redundant duplicates.
    - Writes `.backup` and atomically saves clean Parquet.
    - Prints before/after row & token counts and merged symbols list.
    """
    if not os.path.exists(parquet_path):
        logger.warning(f"Parquet file {parquet_path} does not exist. Nothing to dedupe.")
        return {"status": "skipped", "reason": "file_not_found"}

    df = pd.read_parquet(parquet_path)
    before_rows = len(df)
    before_tokens = df["token"].nunique()

    # Find symbols with multiple tokens
    sym_token_counts = df.groupby("symbol")["token"].nunique()
    dup_symbols = sym_token_counts[sym_token_counts > 1].index.tolist()

    if not dup_symbols:
        logger.info(f"No duplicate symbols found across {before_tokens} tokens in {parquet_path}.")
        return {
            "status": "success",
            "merged_symbols": [],
            "before_rows": before_rows,
            "after_rows": before_rows,
            "before_tokens": before_tokens,
            "after_tokens": before_tokens
        }

    logger.info(f"Found {len(dup_symbols)} symbols with multiple tokens: {dup_symbols}")

    # Query active instruments from Neon DB
    active_tokens_by_symbol = {}
    should_close = False
    try:
        if conn is None:
            from pipeline.db import get_connection
            conn = get_connection()
            should_close = True
        with conn.cursor() as cur:
            cur.execute("SELECT symbol, token FROM instruments WHERE is_active = TRUE;")
            for s, t in cur.fetchall():
                active_tokens_by_symbol[s] = t
    except Exception as e:
        logger.warning(f"Could not query active instruments for dedupe: {e}")
    finally:
        if should_close and conn:
            try:
                conn.close()
            except Exception:
                pass

    merged_info = []

    for sym in dup_symbols:
        sym_df = df[df["symbol"] == sym]
        tokens = sym_df["token"].unique().tolist()

        # Decide winning token:
        # 1. Token currently active in instruments
        # 2. Token with newest max(trade_date)
        # 3. Token with highest count
        preferred_token = active_tokens_by_symbol.get(sym)
        if preferred_token not in tokens:
            # Pick token with latest max trade_date
            token_max_dates = sym_df.groupby("token")["trade_date"].max().to_dict()
            sorted_tokens = sorted(tokens, key=lambda t: (token_max_dates[t], len(sym_df[sym_df["token"] == t])), reverse=True)
            preferred_token = sorted_tokens[0]

        dropped_tokens = [t for t in tokens if t != preferred_token]
        logger.info(f"Symbol {sym}: keeping winning token {preferred_token}, dropping {dropped_tokens}")
        merged_info.append({
            "symbol": sym,
            "kept_token": preferred_token,
            "dropped_tokens": dropped_tokens
        })

        # Re-key all rows for this symbol to preferred_token
        df.loc[df["symbol"] == sym, "token"] = preferred_token

    # Deduplicate by token and trade_date (keep last)
    df = df.drop_duplicates(subset=["token", "trade_date"], keep="last")
    df = df.sort_values(by=["token", "trade_date"])

    after_rows = len(df)
    after_tokens = df["token"].nunique()

    # Write backup
    backup_path = f"{parquet_path}.backup"
    try:
        shutil.copy2(parquet_path, backup_path)
        logger.info(f"Preserved backup copy at {backup_path}")
    except Exception as e:
        logger.warning(f"Failed to create backup copy: {e}")

    # Atomic write
    tmp_path = f"{parquet_path}.tmp"
    df.to_parquet(tmp_path, index=False, compression="snappy")
    os.replace(tmp_path, parquet_path)

    summary = {
        "status": "success",
        "before_rows": before_rows,
        "after_rows": after_rows,
        "rows_removed": before_rows - after_rows,
        "before_tokens": before_tokens,
        "after_tokens": after_tokens,
        "tokens_removed": before_tokens - after_tokens,
        "merged_symbols": [m["symbol"] for m in merged_info],
        "details": merged_info
    }

    print("\n=== Parquet Store Deduplication Complete ===")
    print(f"Before: {before_rows} rows, {before_tokens} tokens")
    print(f"After:  {after_rows} rows, {after_tokens} tokens")
    print(f"Merged {len(merged_info)} symbols: {[m['symbol'] for m in merged_info]}")

    return summary
