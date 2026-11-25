# Classification Seed Source & Attribution

- **Upstream Repository**: https://github.com/dopawire/nse-relative-strength (branch `main`)
- **Pinned Commit**: `a8983c533c59446feb553b760fe82cc719253cee`
- **Pinned Date**: `2026-11-25`
- **License**: MIT License (`Copyright (c) 2026 dopawire`)

## Data Terms & Usage
- Code and CSV structures derived from `dopawire/nse-relative-strength` carry MIT attribution.
- NSE's terms of use may restrict automated redistribution or scraping. These seed CSVs are used exclusively as an offline static bootstrap seed for personal research and analytical grouping within this workspace, never queried per frontend HTTP request.
- Daily incremental sync checks NSE `EQUITY_L.csv` and only fetches missing/incomplete symbols via authorized rate-limited `GetQuoteApi` lookups when needed.

## Seed Files & SHA-256 Checksums
| File | Rows (incl. header) | SHA-256 |
|---|---|---|
| `nse_stock_master.csv` | 2,647 | `4a7fe7dbe467d248a915654ae8ea6cc1b8f99fdc065a35fbab6a151a1ae34a22` |
| `nse_classification_overrides.csv` | 5 | `bd485711a66e69bc5dacd1919d630f5f0bbe64fc366217539a5c0ccf9b0062dd` |
| `nse_symbol_changes.csv` | 14 | `2cd8da6548ef5080e32adb3a9e36935abcfebdb80a4234a45b05ac29350ff54f` |
| `nse_delisted.csv` | 20 | `d5442ea701e971c9413af4966433f5dc323abf54c12b799caadb511949d8449a` |

## Precedence & Normalization Rules
1. Explicit overrides in `nse_classification_overrides.csv` take highest precedence over `nse_stock_master.csv` and live NSE `secInfo` responses (used to correct retired-scheme classifications such as `MANUFACTURING` / `CONSUMER`).
2. Identity matching is **ISIN-first**, followed by uppercase **symbol** (with exchange `'NSE'` and series normalization).
3. All 4 levels (`macro`, `sector`, `industry`, `basicIndustry`) are normalized via `standard_name` (Title Case, joining words lowercase after first word, acronyms preserved, mis-decoded dashes repaired).
4. `macro` must belong to NSE's current 12 macro groups (`CURRENT_MACROS`).

## Refresh Procedure
```sh
# Bootstrap / re-apply pinned seed idempotently
.venv/bin/python -m pipeline.cli classification-bootstrap

# Daily incremental sync (only missing/incomplete/due symbols)
.venv/bin/python -m pipeline.cli classification-sync
```
