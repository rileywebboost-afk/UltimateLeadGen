"""Supabase scraper monitoring helpers.

We use two tables:
- public.scraper_progress: a single row per run (upserted often)
- public.scraper_events: append-only timeline of what is happening

This allows the web app to show:
- initializing
- current search being processed
- how many leads inserted
- how many searches marked used
- completion/failure with error message

Design choice:
- The stable identifier is RUN_KEY which is the workflow_dispatch input timestamp
  sent by the web app. This is unique per "Start" click.

IMPORTANT
- The Supabase Python client is synchronous.
- The scraper code uses an *async* interface ("await monitor.log_event(...)"),
  so we provide async wrappers that call the sync methods.
- Monitoring must never crash the scraper.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ScraperMonitor:
    """Writes progress + event timeline into Supabase.

    Methods are intentionally defensive: failures never raise.
    """

    def __init__(self, supabase_client, run_key: str, github_run_id: Optional[str] = None):
        self.supabase = supabase_client
        self.run_key = run_key
        self.github_run_id = github_run_id

    # -----------------------------
    # Progress row (upsert)
    # -----------------------------
    def upsert_progress(self, payload: dict[str, Any]) -> None:
        """Upsert the progress row.

        We do NOT crash the scraper if monitoring fails.
        """
        try:
            base = {
                "run_key": self.run_key,
                "github_run_id": self.github_run_id,
                "updated_at": _now_iso(),
            }
            base.update(payload)

            # Upsert on run_key
            self.supabase.table("scraper_progress").upsert(base, on_conflict="run_key").execute()
        except Exception:
            return

    # -----------------------------
    # Events (insert)
    # -----------------------------
    def add_event(
        self,
        event_type: str,
        message: str,
        level: str = "info",
        search: Optional[str] = None,
        search_index: Optional[int] = None,
        businesses_extracted: Optional[int] = None,
        businesses_inserted_or_skipped: Optional[int] = None,
        searches_marked_used: Optional[int] = None,
    ) -> None:
        """Insert an event row (append-only)."""
        try:
            row = {
                "run_key": self.run_key,
                "github_run_id": self.github_run_id,
                "level": level,
                "event_type": event_type,
                "message": message,
                "search": search,
                "search_index": search_index,
                "businesses_extracted": businesses_extracted,
                "businesses_inserted_or_skipped": businesses_inserted_or_skipped,
                "searches_marked_used": searches_marked_used,
                "created_at": _now_iso(),
            }
            self.supabase.table("scraper_events").insert(row).execute()
        except Exception:
            return

    # -----------------------------------------------------------------
    # Async compatibility layer (expected by gmaps_scraper.py)
    # -----------------------------------------------------------------
    async def log_event(self, event_type: str, message: str, **kwargs: Any) -> None:
        """Async wrapper for add_event()."""

        self.add_event(event_type, message, **kwargs)

    async def update_progress(self, **kwargs: Any) -> None:
        """Async wrapper for upsert_progress()."""

        self.upsert_progress(kwargs)


class _NoOpMonitor:
    """A monitor that does nothing.

    Returned when RUN_KEY isn't present, so the scraper still runs.
    """

    async def log_event(self, *args: Any, **kwargs: Any) -> None:
        return

    async def update_progress(self, *args: Any, **kwargs: Any) -> None:
        return


def build_monitor(supabase_client):
    """Factory: returns an async monitor.

    If RUN_KEY is missing, returns a no-op monitor.
    """

    run_key = os.getenv("RUN_KEY")
    if not run_key:
        return _NoOpMonitor()

    github_run_id = os.getenv("GITHUB_RUN_ID")
    return ScraperMonitor(supabase_client, run_key=run_key, github_run_id=github_run_id)
