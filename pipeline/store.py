import os
import sys
import logging
import urllib.request
import urllib.parse
import json
from datetime import datetime
from abc import ABC, abstractmethod
from typing import Optional
from pipeline.config import EQUITY_PARQUET_PATH

logger = logging.getLogger("pipeline.store")

class StorageProvider(ABC):
    """Abstract storage interface allowing drop-in replacement with S3, R2, or GitHub Releases."""
    @abstractmethod
    def download(self, remote_name: str, local_path: str) -> bool:
        pass

    @abstractmethod
    def upload(self, local_path: str, remote_name: str, job_succeeded: bool = True) -> bool:
        pass

class GitHubReleaseStorage(StorageProvider):
    """
    Storage provider using GitHub Release assets.
    Downloads at job start and performs atomic upload verification at job completion.
    """
    def __init__(
        self,
        repo: Optional[str] = None,
        token: Optional[str] = None,
        tag: str = "data-latest"
    ):
        self.repo = repo or os.environ.get("GITHUB_REPO") or "dipesh4036/swing"
        self.token = token or os.environ.get("GITHUB_TOKEN")
        self.tag = tag
        self.api_base = f"https://api.github.com/repos/{self.repo}"

    def _headers(self, accept: str = "application/vnd.github+json") -> dict:
        headers = {
            "Accept": accept,
            "User-Agent": "MarketBreadth-StorageProvider",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _get_or_create_release(self) -> Optional[dict]:
        """Gets or creates the data-latest release."""
        if not self.token:
            logger.warning("GITHUB_TOKEN not provided; cannot upload to GitHub Release.")
            return None

        # 1. Check existing release
        try:
            url = f"{self.api_base}/releases/tags/{self.tag}"
            req = urllib.request.Request(url, headers=self._headers())
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code != 404:
                logger.error(f"Error checking release {self.tag}: {e}")
                return None
        except Exception as e:
            logger.error(f"Unexpected error checking release: {e}")
            return None

        # 2. Create release if 404
        try:
            url = f"{self.api_base}/releases"
            payload = json.dumps({
                "tag_name": self.tag,
                "name": "Latest Equity OHLCV Store",
                "body": "Automated data store managed by Market Breadth Pipeline.",
                "draft": False,
                "prerelease": False
            }).encode()
            req = urllib.request.Request(url, data=payload, headers=self._headers())
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:
            logger.error(f"Failed to create release {self.tag}: {e}")
            return None

    def download(self, remote_name: str = "equity_ohlcv.parquet", local_path: str = EQUITY_PARQUET_PATH) -> bool:
        """Download asset from GitHub Release to local_path."""
        import shutil
        os.makedirs(os.path.dirname(os.path.abspath(local_path)), exist_ok=True)
        try:
            url = f"{self.api_base}/releases/tags/{self.tag}"
            req = urllib.request.Request(url, headers=self._headers())
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())

            assets = data.get("assets", [])
            target_asset = next((a for a in assets if a["name"] == remote_name), None)
            if not target_asset:
                logger.info(f"Asset '{remote_name}' not found in release '{self.tag}'. Starting with clean local store.")
                if os.path.exists(local_path):
                    shutil.copy2(local_path, local_path + ".orig")
                return False

            asset_url = target_asset["url"]
            download_headers = self._headers(accept="application/octet-stream")
            dl_req = urllib.request.Request(asset_url, headers=download_headers)
            with urllib.request.urlopen(dl_req, timeout=60) as dl_resp:
                with open(local_path, "wb") as f:
                    f.write(dl_resp.read())

            downloaded_size = os.path.getsize(local_path)
            # Create a local .orig copy to preserve as .backup upon successful upload
            shutil.copy2(local_path, local_path + ".orig")
            logger.info(f"Successfully downloaded '{remote_name}' ({downloaded_size} bytes) to {local_path}.")
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                logger.info(f"Release tag '{self.tag}' not found. Starting with clean store.")
                if os.path.exists(local_path):
                    shutil.copy2(local_path, local_path + ".orig")
                return False
            logger.error(f"HTTP error downloading '{remote_name}': {e}")
            return False
        except Exception as e:
            logger.warning(f"Could not download '{remote_name}' from release: {e}")
            return False

    def upload(self, local_path: str = EQUITY_PARQUET_PATH, remote_name: str = "equity_ohlcv.parquet", job_succeeded: bool = True) -> bool:
        """Upload local_path to release asset under temp name, verify, and swap."""
        if not job_succeeded:
            logger.warning("Job failed or was aborted. Skipping asset upload to prevent store corruption.")
            return False

        if not os.path.exists(local_path):
            logger.error(f"Local file {local_path} does not exist. Cannot upload.")
            return False

        file_size = os.path.getsize(local_path)
        if file_size < 1000:
            logger.error(f"File {local_path} size ({file_size} bytes) is suspiciously small. Aborting upload.")
            return False

        release = self._get_or_create_release()
        if not release:
            logger.error("Could not obtain release object for upload.")
            return False

        upload_url = release.get("upload_url", "").replace("{?name,label}", "")
        if not upload_url:
            logger.error("Invalid upload_url from GitHub Releases API.")
            return False

        try:
            # 1. Check existing assets in release
            assets = release.get("assets", [])
            temp_name = f"{remote_name}.tmp"
            backup_name = f"{remote_name}.backup"

            # Delete any stale temp asset if present
            for a in assets:
                if a["name"] == temp_name:
                    del_req = urllib.request.Request(a["url"], headers=self._headers(), method="DELETE")
                    try:
                        urllib.request.urlopen(del_req, timeout=15)
                    except Exception:
                        pass

            # 2. Upload file under temp_name
            logger.info(f"Uploading {local_path} ({file_size} bytes) as temporary asset '{temp_name}'...")
            with open(local_path, "rb") as f:
                content = f.read()

            upload_temp_url = f"{upload_url}?name={temp_name}"
            up_headers = {
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/octet-stream",
                "Content-Length": str(len(content)),
                "User-Agent": "MarketBreadth-StorageProvider",
            }
            up_req = urllib.request.Request(upload_temp_url, data=content, headers=up_headers, method="POST")
            with urllib.request.urlopen(up_req, timeout=120) as up_resp:
                temp_asset = json.loads(up_resp.read().decode())

            # 3. Verify uploaded temp asset size
            uploaded_size = temp_asset.get("size", 0)
            if uploaded_size != file_size:
                logger.error(f"Upload size verification failed: expected {file_size}, got {uploaded_size}. Aborting swap.")
                return False

            logger.info(f"Verified uploaded asset size ({uploaded_size} bytes). Preserving backup and swapping to '{remote_name}'...")

            # 4. Handle previous existing file as .backup
            orig_path = local_path + ".orig"
            if os.path.exists(orig_path):
                # Delete existing backup asset if present
                for a in assets:
                    if a["name"] == backup_name:
                        del_req = urllib.request.Request(a["url"], headers=self._headers(), method="DELETE")
                        try:
                            urllib.request.urlopen(del_req, timeout=15)
                        except Exception:
                            pass
                # Upload orig as backup
                with open(orig_path, "rb") as bf:
                    orig_content = bf.read()
                up_backup_url = f"{upload_url}?name={backup_name}"
                b_headers = dict(up_headers)
                b_headers["Content-Length"] = str(len(orig_content))
                b_req = urllib.request.Request(up_backup_url, data=orig_content, headers=b_headers, method="POST")
                try:
                    urllib.request.urlopen(b_req, timeout=120)
                    logger.info(f"Preserved previous file as '{backup_name}' in release.")
                except Exception as be:
                    logger.warning(f"Could not upload backup asset: {be}")

            for a in assets:
                if a["name"] == remote_name:
                    # Delete old remote_name asset before replacing
                    del_req = urllib.request.Request(a["url"], headers=self._headers(), method="DELETE")
                    try:
                        urllib.request.urlopen(del_req, timeout=15)
                    except Exception:
                        pass

            # 5. Upload final asset as remote_name
            upload_final_url = f"{upload_url}?name={remote_name}"
            final_req = urllib.request.Request(upload_final_url, data=content, headers=up_headers, method="POST")
            with urllib.request.urlopen(final_req, timeout=120) as final_resp:
                final_asset = json.loads(final_resp.read().decode())

            # 6. Delete temp asset
            if temp_asset.get("url"):
                del_temp_req = urllib.request.Request(temp_asset["url"], headers=self._headers(), method="DELETE")
                try:
                    urllib.request.urlopen(del_temp_req, timeout=15)
                except Exception:
                    pass

            # 7. Clean up local .orig
            if os.path.exists(orig_path):
                try:
                    os.remove(orig_path)
                except Exception:
                    pass

            logger.info(f"Successfully uploaded and verified '{remote_name}' to release '{self.tag}'.")
            return True

        except Exception as e:
            logger.error(f"Failed to upload asset to GitHub Release: {e}")
            return False

    def upload_asset(self, local_path: str, remote_name: str) -> bool:
        """Uploads a standalone asset (e.g. breadth backup or dated parquet) to release."""
        if not self.token or not os.path.exists(local_path):
            return False

        release = self._get_or_create_release()
        if not release:
            return False

        upload_url = release.get("upload_url", "").replace("{?name,label}", "")
        if not upload_url:
            return False

        try:
            # Delete asset if already exists with same name
            assets = release.get("assets", [])
            for a in assets:
                if a["name"] == remote_name:
                    del_req = urllib.request.Request(a["url"], headers=self._headers(), method="DELETE")
                    try:
                        urllib.request.urlopen(del_req, timeout=15)
                    except Exception:
                        pass

            with open(local_path, "rb") as f:
                content = f.read()

            up_url = f"{upload_url}?name={remote_name}"
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/octet-stream",
                "Content-Length": str(len(content)),
                "User-Agent": "MarketBreadth-StorageProvider",
            }
            req = urllib.request.Request(up_url, data=content, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=120) as resp:
                logger.info(f"Uploaded standalone asset '{remote_name}' ({len(content)} bytes) to release.")
                return True
        except Exception as e:
            logger.warning(f"Could not upload asset '{remote_name}': {e}")
            return False

    def prune_dated_backups(self, prefix: str = "equity_ohlcv_", max_keep: int = 4) -> int:
        """Keeps only the latest max_keep dated backups in release and prunes older ones."""
        if not self.token:
            return 0

        release = self._get_or_create_release()
        if not release:
            return 0

        assets = release.get("assets", [])
        dated_assets = [
            a for a in assets
            if a["name"].startswith(prefix) and a["name"].endswith(".parquet") and a["name"] != "equity_ohlcv.parquet"
        ]
        # Sort descending by name (names contain YYYYMMDD)
        dated_assets.sort(key=lambda a: a["name"], reverse=True)

        pruned_count = 0
        if len(dated_assets) > max_keep:
            for a in dated_assets[max_keep:]:
                try:
                    logger.info(f"Pruning older dated backup asset '{a['name']}' from release...")
                    del_req = urllib.request.Request(a["url"], headers=self._headers(), method="DELETE")
                    urllib.request.urlopen(del_req, timeout=15)
                    pruned_count += 1
                except Exception as e:
                    logger.warning(f"Could not delete old backup asset '{a['name']}': {e}")

        return pruned_count

# Global storage provider instance
_default_storage: Optional[GitHubReleaseStorage] = None

def get_storage_provider() -> GitHubReleaseStorage:
    global _default_storage
    if _default_storage is None:
        _default_storage = GitHubReleaseStorage()
    return _default_storage

def download_parquet_store(local_path: str = EQUITY_PARQUET_PATH) -> bool:
    return get_storage_provider().download("equity_ohlcv.parquet", local_path)

def upload_parquet_store(local_path: str = EQUITY_PARQUET_PATH, job_succeeded: bool = True) -> bool:
    return get_storage_provider().upload(local_path, "equity_ohlcv.parquet", job_succeeded=job_succeeded)

def backup_weekly_release(parquet_path: str = EQUITY_PARQUET_PATH, conn=None) -> bool:
    """
    Weekly backup procedure per Phase 5 spec:
    1. Exports daily_market_breadth table to daily_market_breadth.csv and uploads to release.
    2. Uploads dated copy equity_ohlcv_<YYYYMMDD>.parquet to release.
    3. Prunes older dated copies keeping the last 4.
    """
    storage = get_storage_provider()
    today_str = datetime.now().strftime("%Y%m%d")

    # 1. Export breadth table
    try:
        from pipeline.db import get_connection
        close_conn = False
        if conn is None:
            conn = get_connection()
            close_conn = True

        export_path = "data/daily_market_breadth.csv"
        os.makedirs("data", exist_ok=True)
        import pandas as pd
        df_breadth = pd.read_sql("SELECT * FROM daily_market_breadth ORDER BY trade_date ASC;", conn)
        df_breadth.to_csv(export_path, index=False)
        storage.upload_asset(export_path, "daily_market_breadth.csv")
        logger.info(f"Exported and uploaded daily_market_breadth.csv ({len(df_breadth)} rows) to release.")
        if close_conn:
            conn.close()
    except Exception as e:
        logger.warning(f"Could not export daily_market_breadth backup: {e}")

    # 2. Upload dated parquet copy
    if os.path.exists(parquet_path):
        dated_name = f"equity_ohlcv_{today_str}.parquet"
        storage.upload_asset(parquet_path, dated_name)
        # 3. Prune older backups keeping last 4
        storage.prune_dated_backups("equity_ohlcv_", max_keep=4)

    return True

