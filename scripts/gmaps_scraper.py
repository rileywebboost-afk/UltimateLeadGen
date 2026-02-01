"""Ultimate Lead Gen - Google Maps scraper (GitHub Actions).

Goals
- Read unused searches from Supabase table: public."Google_Maps Searches" (Searches PK, searchUSED boolean)
- For each search:
  - Load Google Maps search
  - Identify listing cards reliably
  - Click into each listing and extract details
  - Insert businesses into public."Roofing Leads New" (dedupe by unique title index)
  - Mark the search as used (searchUSED=true) only when we successfully loaded results
- Always write scraper_results.json for artifact upload.

Notes
- Google Maps DOM changes frequently. We use multiple selector strategies and defensive waits.
- GitHub runners can be rate-limited by Google. If you see frequent timeouts/empty results, add proxies later.
"""

import asyncio
import json
import os
import re
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any, Optional

from playwright.async_api import async_playwright, Page, TimeoutError as PwTimeout
from supabase import create_client

# Monitoring: write real-time progress + event timeline to Supabase
from scripts.scraper_monitor import build_monitor


# ----------------------------
# Config
# ----------------------------
MAX_RESULTS_PER_SEARCH = int(os.getenv("MAX_RESULTS_PER_SEARCH", "20"))
NAV_TIMEOUT_MS = int(os.getenv("NAV_TIMEOUT_MS", "90000"))  # Google Maps can be slow
ACTION_TIMEOUT_MS = int(os.getenv("ACTION_TIMEOUT_MS", "20000"))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# ----------------------------
# Helpers
# ----------------------------

def normalize_space(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def parse_rating_from_aria(aria: Optional[str]) -> Optional[str]:
    if not aria:
        return None
    # Examples: "4.6 stars" / "4.6 stars from 127 reviews"
    m = re.search(r"(\d+(?:\.\d+)?)\s*star", aria, re.I)
    return m.group(1) if m else None


async def safe_text(page: Page, selector: str) -> Optional[str]:
    try:
        el = await page.query_selector(selector)
        if not el:
            return None
        txt = await el.text_content()
        return normalize_space(txt) if txt else None
    except Exception:
        return None


async def safe_attr(page: Page, selector: str, attr: str) -> Optional[str]:
    try:
        el = await page.query_selector(selector)
        if not el:
            return None
        val = await el.get_attribute(attr)
        return val
    except Exception:
        return None


async def click_if_present(page: Page, selector: str) -> bool:
    try:
        el = await page.query_selector(selector)
        if not el:
            return False
        await el.click(timeout=3000)
        return True
    except Exception:
        return False


async def handle_google_consent(page: Page) -> None:
    """Try to dismiss EU/UK consent dialogs if they appear."""

    # Common buttons
    candidates = [
        'button:has-text("Reject all")',
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button:has-text("Agree")',
        'button[aria-label="Reject all"]',
        'button[aria-label="Accept all"]',
    ]

    for sel in candidates:
        clicked = await click_if_present(page, sel)
        if clicked:
            await page.wait_for_timeout(500)
            return


# ----------------------------
# Supabase IO
# ----------------------------


def fetch_unused_searches(limit: int = 1000) -> list[dict[str, Any]]:
    # Limit to 1000 per run for safety.
    res = (
        supabase.table('Google_Maps Searches')
        .select('Searches,searchUSED')
        .eq('searchUSED', False)
        .limit(limit)
        .execute()
    )
    return res.data or []


def mark_search_used(search: str) -> None:
    supabase.table('Google_Maps Searches').update({'searchUSED': True}).eq('Searches', search).execute()


def get_next_row_number_start() -> int:
    # Pull max(RowNumber) once.
    res = supabase.table('Roofing Leads New').select('RowNumber').order('RowNumber', desc=True).limit(1).execute()
    if res.data:
        return int(res.data[0]['RowNumber']) + 1
    return 1


def insert_roofing_lead(row: dict[str, Any]) -> bool:
    """Insert one lead row. Returns True if inserted or skipped as duplicate."""
    try:
        supabase.table('Roofing Leads New').insert(row).execute()
        return True
    except Exception as e:
        # Dedup by unique index on normalized title (partial index).
        msg = str(e).lower()
        if 'duplicate' in msg or 'unique' in msg:
            return True
        print(f"    DB insert error: {str(e)[:200]}")
        return False


# ----------------------------
# Scraping
# ----------------------------


@dataclass
class Business:
    title: Optional[str] = None
    map_link: Optional[str] = None
    cover_image: Optional[str] = None
    rating: Optional[str] = None
    category: Optional[str] = None
    address: Optional[str] = None
    webpage: Optional[str] = None
    phone_number: Optional[str] = None
    working_hours: Optional[str] = None


async def wait_for_results(page: Page) -> bool:
    """Wait until the results feed shows up or we detect no-results."""
    try:
        await page.wait_for_selector('div[role="feed"]', timeout=30000)
        return True
    except Exception:
        # sometimes results container uses role="main" only; fall back
        try:
            await page.wait_for_selector('div[role="main"]', timeout=5000)
            return True
        except Exception:
            return False


async def get_listing_cards(page: Page) -> list:
    """Return clickable listing cards."""
    # Primary card container in search results
    cards = await page.query_selector_all('div.Nv2PK')
    if cards:
        return cards

    # fallback: anchor to listing
    cards = await page.query_selector_all('a.hfpxzc')
    if cards:
        return cards

    # last resort
    return await page.query_selector_all('[data-item-id]')


async def extract_details(page: Page) -> Optional[Business]:
    # Title
    title = await safe_text(page, 'h1.DUwDvf') or await safe_text(page, 'h1')
    if not title:
        return None

    # Rating
    aria = await safe_attr(page, 'span[aria-label*="star"]', 'aria-label')
    rating = parse_rating_from_aria(aria)

    # Category (often a button near top)
    category = await safe_text(page, 'button.DkEaL') or await safe_text(page, 'span.DkEaL')

    # Address, phone, website use data-item-id in details panel (most reliable)
    address = await safe_text(page, '[data-item-id="address"] .Io6YTe') or await safe_text(page, '[data-item-id="address"] .rogA2c')
    phone = await safe_text(page, '[data-item-id^="phone"] .Io6YTe') or await safe_text(page, '[data-item-id^="phone"] .rogA2c')

    website = (
        await safe_attr(page, 'a[data-item-id="authority"]', 'href')
        or await safe_attr(page, '[data-item-id="authority"] a', 'href')
    )

    # Hours
    hours = await safe_text(page, '[data-item-id="oh"] .Io6YTe') or await safe_text(page, '[data-item-id="oh"] .rogA2c')

    # Cover image (best effort)
    cover = await safe_attr(page, 'img[src^="https://lh5.googleusercontent.com"]', 'src')

    return Business(
        title=title,
        map_link=page.url,
        cover_image=cover,
        rating=rating,
        category=category,
        address=address,
        webpage=website,
        phone_number=phone,
        working_hours=hours,
    )


async def scrape_search(page: Page, query: str) -> tuple[list[Business], bool, str | None]:
    """Returns (businesses, loaded_ok, error_message)"""

    url = f"https://www.google.com/maps/search/{query.replace(' ', '+')}"

    try:
        await page.goto(url, wait_until='domcontentloaded', timeout=NAV_TIMEOUT_MS)
        await page.wait_for_timeout(750)
        await handle_google_consent(page)

        ok = await wait_for_results(page)
        if not ok:
            return [], False, "results_not_found"

        # Collect cards (ensure not empty)
        cards = await get_listing_cards(page)
        if not cards:
            return [], True, "no_cards_found"

        businesses: list[Business] = []

        # Click through first N cards
        for i, card in enumerate(cards[:MAX_RESULTS_PER_SEARCH]):
            try:
                await card.click(timeout=ACTION_TIMEOUT_MS)
                # Wait for details panel title to render
                try:
                    await page.wait_for_selector('h1.DUwDvf, h1', timeout=ACTION_TIMEOUT_MS)
                except Exception:
                    pass

                b = await extract_details(page)
                if b and b.title:
                    businesses.append(b)
            except PwTimeout:
                continue
            except Exception:
                continue

        return businesses, True, None

    except PwTimeout:
        return [], False, "goto_timeout"
    except Exception as e:
        return [], False, f"error:{str(e)[:120]}"


async def run() -> dict[str, Any]:
    started = datetime.now().isoformat()

    # Build monitoring helper (safe no-op if RUN_KEY env var is missing)
    monitor = build_monitor(supabase)
    if monitor:
        monitor.upsert_progress({
            "status": "initializing",
            "current_action": "boot",
            "started_at": started,
        })
        monitor.add_event("INIT", "Scraper initializing (Playwright + Supabase)")

    searches = fetch_unused_searches(limit=1000)

    if monitor:
        monitor.upsert_progress({
            "status": "running",
            "current_action": "loaded_search_queue",
            "total_searches": len(searches),
        })
        monitor.add_event("QUEUE", f"Loaded {len(searches)} unused searches from Supabase")

    results: dict[str, Any] = {
        "started_at": started,
        "finished_at": None,
        "searches_total": len(searches),
        "searches_loaded_ok": 0,
        "searches_marked_used": 0,
        "searches_errors": 0,
        "businesses_extracted": 0,
        "businesses_inserted_or_skipped": 0,
        "sample_errors": [],
    }

    row_number = get_next_row_number_start()

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
            ],
        )
        context = await browser.new_context(
            locale='en-GB',
            timezone_id='Europe/London',
            viewport={"width": 1280, "height": 800},
            user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        )
        page = await context.new_page()
        page.set_default_timeout(ACTION_TIMEOUT_MS)

        for idx, s in enumerate(searches):
            query = s["Searches"]

            # ---------------------------------------------------------
            # Monitoring: announce which search we are about to run.
            # This is the key missing piece for UI visibility.
            # ---------------------------------------------------------
            if monitor:
                monitor.upsert_progress({
                    "status": "running",
                    "current_action": "loading_search",
                    "current_search": query,
                    "current_search_index": idx + 1,
                    "total_searches": len(searches),
                    "searches_processed": idx,
                    "businesses_extracted": results["businesses_extracted"],
                    "businesses_inserted_or_skipped": results["businesses_inserted_or_skipped"],
                    "searches_marked_used": results["searches_marked_used"],
                    "searches_loaded_ok": results["searches_loaded_ok"],
                    "searches_errors": results["searches_errors"],
                })
                monitor.add_event(
                    "SEARCH_START",
                    f"Starting search: {query}",
                    search=query,
                    search_index=idx + 1,
                )

            print(f"[{idx+1}/{len(searches)}] {query}")

            # ---------------------------------------------------------
            # Run the actual Google Maps scraping for this search.
            # ---------------------------------------------------------
            businesses, loaded_ok, err = await scrape_search(page, query)

            if loaded_ok:
                results["searches_loaded_ok"] += 1

            if err:
                results["searches_errors"] += 1
                if len(results["sample_errors"]) < 25:
                    results["sample_errors"].append({"search": query, "error": err})

                if monitor:
                    monitor.add_event(
                        "SEARCH_ERROR",
                        f"Search produced an error: {err}",
                        level="warn",
                        search=query,
                        search_index=idx + 1,
                    )

            # ---------------------------------------------------------
            # Monitoring: how many businesses did we extract?
            # ---------------------------------------------------------
            results["businesses_extracted"] += len(businesses)

            if monitor:
                monitor.upsert_progress({
                    "current_action": "extracted_businesses",
                    "businesses_extracted": results["businesses_extracted"],
                    "searches_loaded_ok": results["searches_loaded_ok"],
                    "searches_errors": results["searches_errors"],
                })
                monitor.add_event(
                    "EXTRACT",
                    f"Extracted {len(businesses)} businesses",
                    search=query,
                    search_index=idx + 1,
                    businesses_extracted=len(businesses),
                )

            # ---------------------------------------------------------
            # Insert businesses into Supabase
            # ---------------------------------------------------------
            inserted_this_search = 0
            for b in businesses:
                row = {
                    "RowNumber": row_number,
                    "title": b.title,
                    "map_link": b.map_link,
                    "cover_image": b.cover_image,
                    "rating": b.rating,
                    "category": b.category,
                    "address": b.address,
                    "webpage": b.webpage,
                    "phone_number": b.phone_number,
                    "working_hours": b.working_hours,
                    "Used": False,
                }
                ok = insert_roofing_lead(row)
                if ok:
                    results["businesses_inserted_or_skipped"] += 1
                    inserted_this_search += 1
                row_number += 1

            if monitor:
                monitor.upsert_progress({
                    "current_action": "inserted_businesses",
                    "businesses_inserted_or_skipped": results["businesses_inserted_or_skipped"],
                })
                monitor.add_event(
                    "DB_INSERT",
                    f"Inserted/skipped {inserted_this_search} businesses into Roofing Leads New",
                    search=query,
                    search_index=idx + 1,
                    businesses_inserted_or_skipped=inserted_this_search,
                )

            # ---------------------------------------------------------
            # Mark search used ONLY if we successfully loaded results.
            # ---------------------------------------------------------
            if loaded_ok:
                if monitor:
                    monitor.upsert_progress({
                        "current_action": "marking_search_used",
                    })

                mark_search_used(query)
                results["searches_marked_used"] += 1

                if monitor:
                    monitor.upsert_progress({
                        "current_action": "search_marked_used",
                        "searches_marked_used": results["searches_marked_used"],
                    })
                    monitor.add_event(
                        "SEARCH_MARK_USED",
                        "Marked search as used in Google_Maps Searches",
                        search=query,
                        search_index=idx + 1,
                        searches_marked_used=1,
                    )

            # ---------------------------------------------------------
            # Gentle pacing (and a convenient heartbeat for monitoring)
            # ---------------------------------------------------------
            if monitor:
                monitor.upsert_progress({
                    "searches_processed": idx + 1,
                    "current_action": "waiting_between_searches",
                })

            await page.wait_for_timeout(750)


        

        await context.close()
        await browser.close()

    results["finished_at"] = datetime.now().isoformat()

    # Monitoring: mark run completed
    if monitor:
        monitor.upsert_progress({
            "status": "completed",
            "current_action": "completed",
            "businesses_extracted": results["businesses_extracted"],
            "businesses_inserted_or_skipped": results["businesses_inserted_or_skipped"],
            "searches_loaded_ok": results["searches_loaded_ok"],
            "searches_errors": results["searches_errors"],
            "searches_marked_used": results["searches_marked_used"],
            "searches_processed": results["searches_total"],
            "completed_at": results["finished_at"],
        })
        monitor.add_event(
            "COMPLETE",
            f"Scraper completed. Inserted/skipped {results['businesses_inserted_or_skipped']} total businesses.",
        )

    return results


def write_results_file(payload: dict[str, Any]) -> None:
    with open("scraper_results.json", "w") as f:
        json.dump(payload, f, indent=2)


if __name__ == "__main__":
    out: dict[str, Any]
    try:
        out = asyncio.run(run())
    except Exception as e:
        out = {
            "started_at": datetime.now().isoformat(),
            "finished_at": datetime.now().isoformat(),
            "status": "fatal_error",
            "error": str(e),
        }

        # Monitoring: mark run failed (best-effort)
        try:
            monitor = build_monitor(supabase)
            if monitor:
                monitor.upsert_progress({
                    "status": "failed",
                    "current_action": "failed",
                    "error_message": str(e)[:500],
                    "completed_at": out["finished_at"],
                })
                monitor.add_event(
                    "FATAL",
                    f"Scraper crashed: {str(e)[:200]}",
                    level="error",
                )
        except Exception:
            pass

        raise
    finally:
        # Always create results file for artifact upload
        try:
            if "out" not in locals():
                out = {
                    "started_at": datetime.now().isoformat(),
                    "finished_at": datetime.now().isoformat(),
                    "status": "unknown_state",
                }
            write_results_file(out)
            print("Wrote scraper_results.json")
        except Exception:
            pass
