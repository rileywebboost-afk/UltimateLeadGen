"""Ultimate Lead Gen - Google Maps scraper (GitHub Actions).

This scraper is intentionally defensive because Google Maps DOM changes often and
headless sessions can be rate limited.

Key strategy changes vs older versions
- DO NOT click generic "div[role=button]" elements (too broad; hits lots of UI).
- Instead, collect place links from the left results feed (usually anchors with
  class "hfpxzc"), scrolling the feed to load more.
- Visit each place link directly (page.goto) and extract details.

Debugging
- Writes debug screenshots + HTML snapshots to ./artifacts/debug (uploaded as an
  artifact in GitHub Actions).
"""

import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Page, TimeoutError as PwTimeout
from supabase import create_client

# Monitoring: write real-time progress + event timeline to Supabase
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scraper_monitor import build_monitor


# ----------------------------
# Config
# ----------------------------
MAX_RESULTS_PER_SEARCH = int(os.getenv("MAX_RESULTS_PER_SEARCH", "20"))
NAV_TIMEOUT_MS = int(os.getenv("NAV_TIMEOUT_MS", "90000"))
ACTION_TIMEOUT_MS = int(os.getenv("ACTION_TIMEOUT_MS", "20000"))

DEBUG_DIR = Path(os.getenv("DEBUG_DIR", "artifacts/debug"))
DEBUG_MAX_PAGES = int(os.getenv("DEBUG_MAX_PAGES", "8"))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
RUN_KEY = os.getenv("RUN_KEY", datetime.utcnow().isoformat())
GITHUB_RUN_ID = os.getenv("GITHUB_RUN_ID", "unknown")


@dataclass
class Business:
    title: str
    address: str
    phone_number: Optional[str] = None
    rating: Optional[str] = None
    webpage: Optional[str] = None
    category: Optional[str] = None
    working_hours: Optional[str] = None
    map_link: Optional[str] = None


# Supabase client (service role)
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# ----------------------------
# Debug helpers
# ----------------------------
_debug_writes = 0


async def write_debug(page: Page, stem: str) -> None:
    """Persist a screenshot + HTML snapshot for offline inspection.

    We cap the number of debug writes to avoid huge artifacts.
    """

    global _debug_writes
    if _debug_writes >= DEBUG_MAX_PAGES:
        return

    try:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", stem)[:120]

        png_path = DEBUG_DIR / f"{ts}_{safe}.png"
        html_path = DEBUG_DIR / f"{ts}_{safe}.html"

        await page.screenshot(path=str(png_path), full_page=True)
        content = await page.content()
        html_path.write_text(content, encoding="utf-8")

        _debug_writes += 1
        print(f"  🧪 Debug saved: {png_path.name}, {html_path.name}")
    except Exception as e:
        print(f"  ⚠️  Failed to write debug artifacts: {e}")


async def detect_blocked(page: Page) -> bool:
    """Detect common 'blocked' / consent / unusual traffic situations."""

    url = page.url or ""
    if "sorry" in url or "consent" in url:
        return True

    try:
        body = (await page.text_content("body")) or ""
        body_l = body.lower()
        blocked_markers = [
            "unusual traffic",
            "automated queries",
            "our systems have detected",
            "sorry",
            "before you continue to google",
        ]
        return any(m in body_l for m in blocked_markers)
    except Exception:
        return False


async def maybe_accept_consent(page: Page) -> None:
    """Attempt to accept cookie/consent dialogs if they appear."""

    # These vary by geo. We try a few common button texts.
    candidates = [
        "button:has-text('Accept all')",
        "button:has-text('I agree')",
        "button:has-text('Accept')",
        "button:has-text('Agree')",
        "form button:has-text('Accept all')",
    ]
    for sel in candidates:
        try:
            btn = page.locator(sel).first
            if await btn.count():
                # Only click if visible
                if await btn.is_visible():
                    await btn.click(timeout=1500)
                    await page.wait_for_timeout(800)
                    return
        except Exception:
            continue


# ----------------------------
# Extraction helpers
# ----------------------------
async def _first_text(page: Page, selectors: list[str]) -> Optional[str]:
    for sel in selectors:
        try:
            el = await page.query_selector(sel)
            if not el:
                continue
            txt = await el.text_content()
            if txt and txt.strip():
                return txt.strip()
        except Exception:
            continue
    return None


async def _get_aria_or_text(page: Page, selectors: list[str], prefix_strip: Optional[str] = None) -> Optional[str]:
    """Try aria-label first (more stable for Maps), then visible text."""

    for sel in selectors:
        try:
            el = await page.query_selector(sel)
            if not el:
                continue
            aria = await el.get_attribute("aria-label")
            if aria and aria.strip():
                val = aria.strip()
                if prefix_strip and val.lower().startswith(prefix_strip.lower()):
                    val = val[len(prefix_strip) :].strip()
                return val
            txt = await el.text_content()
            if txt and txt.strip():
                return txt.strip()
        except Exception:
            continue
    return None


async def extract_business_details(page: Page, listing_url: str, search_index: int, monitor) -> Optional[Business]:
    """Extract details from an individual place page."""

    try:
        await page.wait_for_timeout(400)

        # Title is the hard requirement
        title = await _first_text(
            page,
            [
                "h1",
                "div[role='heading']",
                "div.fontHeadlineSmall",
                "h2",
            ],
        )
        if not title or len(title) < 2:
            await write_debug(page, f"no_title_search{search_index}")
            await monitor.log_event("EXTRACT_NO_TITLE", "No title found on place page", level="warn")
            return None

        address = await _get_aria_or_text(
            page,
            [
                "button[data-item-id='address']",
                "div[data-item-id='address']",
                "button[aria-label*='Address']",
                "button[aria-label*='address']",
            ],
            prefix_strip="Address:",
        ) or ""

        phone = await _get_aria_or_text(
            page,
            [
                "button[data-item-id='phone:tel']",
                "a[data-item-id='phone:tel']",
                "a[href^='tel:']",
                "button[aria-label*='Phone']",
                "button[aria-label*='phone']",
            ],
            prefix_strip="Phone:",
        )

        # Rating is usually in aria-label like "4.6 stars"
        rating = None
        for sel in ["div[role='img'][aria-label*='star']", "div[aria-label*='star']"]:
            try:
                el = await page.query_selector(sel)
                if not el:
                    continue
                aria = await el.get_attribute("aria-label")
                if not aria:
                    continue
                m = re.search(r"([\d.]+)\s*star", aria)
                if m:
                    rating = m.group(1)
                    break
            except Exception:
                continue

        website = None
        for sel in [
            "a[data-item-id='website']",
            "a[aria-label*='Website']",
            "a[aria-label*='website']",
            "a[data-item-id='authority']",
        ]:
            try:
                el = await page.query_selector(sel)
                if not el:
                    continue
                href = await el.get_attribute("href")
                if href and href.startswith("http") and "google.com" not in href:
                    website = href
                    break
            except Exception:
                continue

        # Category is often near the title area; this is best-effort.
        category = await _first_text(
            page,
            [
                "button[jsaction*='pane.rating.category']",
                "button[jsname='x8hlje']",
                "div.fontBodyMedium > button",
            ],
        )

        working_hours = await _first_text(page, ["div[data-item-id='oh']", "div[aria-label*='Hours']", "div[aria-label*='hours']"])

        return Business(
            title=title,
            address=address,
            phone_number=phone,
            rating=rating,
            webpage=website,
            category=category,
            working_hours=working_hours,
            map_link=listing_url,
        )

    except Exception as e:
        await write_debug(page, f"extract_error_search{search_index}")
        await monitor.log_event("EXTRACT_ERROR", f"Extraction error: {e}", level="error")
        return None


# ----------------------------
# Results feed scraping
# ----------------------------
async def collect_place_links(page: Page, search_index: int, monitor, max_needed: int) -> list[str]:
    """Collect place links from the left results panel (feed).

    This is far more reliable than clicking generic div[role=button].
    """

    hrefs: list[str] = []
    seen: set[str] = set()

    # Primary: left results feed
    feed = page.locator("div[role='feed']").first

    try:
        await feed.wait_for(timeout=15000)
    except Exception:
        # Fallback: still try global anchors
        await monitor.log_event("FEED_NOT_FOUND", "Results feed not found; falling back to global anchors", level="warn")
        await write_debug(page, f"no_feed_search{search_index}")

    # We'll scroll up to N times or until we have enough unique links
    for round_i in range(25):
        # Prefer anchors inside feed
        locators = []
        try:
            if await feed.count():
                locators.append(feed.locator("a.hfpxzc"))
        except Exception:
            pass
        # Fallback: any anchor that looks like a place link
        locators.append(page.locator("a[href*='/maps/place']"))

        for loc in locators:
            try:
                links = await loc.evaluate_all("els => els.map(e => e.href).filter(Boolean)")
            except Exception:
                continue

            for h in links:
                if not isinstance(h, str):
                    continue
                if "/maps/place" not in h:
                    continue
                if h in seen:
                    continue
                seen.add(h)
                hrefs.append(h)

        if len(hrefs) >= max_needed:
            break

        # Scroll the feed (if present) to load more
        try:
            if await feed.count():
                await feed.evaluate("el => el.scrollBy(0, el.scrollHeight)")
            else:
                await page.mouse.wheel(0, 2500)
        except Exception:
            pass

        await page.wait_for_timeout(900)

        if round_i in (0, 3, 8) and len(hrefs) == 0:
            # Early debug if we're seeing nothing
            await write_debug(page, f"no_links_round{round_i}_search{search_index}")

    return hrefs


async def scrape_search(page: Page, search_query: str, search_index: int, total_searches: int, monitor) -> tuple[list[Business], int]:
    businesses: list[Business] = []

    await monitor.log_event("SEARCH_START", f"Starting search: {search_query}", search=search_query, search_index=search_index)

    search_url = f"https://www.google.com/maps/search/{search_query.replace(' ', '+')}"
    print(f"\n[{search_index}/{total_searches}] Searching: {search_query}")

    try:
        await page.goto(search_url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        await page.wait_for_timeout(1200)
        await maybe_accept_consent(page)

        if await detect_blocked(page):
            await write_debug(page, f"blocked_search{search_index}")
            await monitor.log_event("BLOCKED", "Google blocked or consent page encountered", level="error", search=search_query)
            return [], 0

        hrefs = await collect_place_links(page, search_index, monitor, max_needed=MAX_RESULTS_PER_SEARCH)
        print(f"  Found {len(hrefs)} place links")

        await monitor.log_event(
            "LISTINGS_FOUND",
            f"Found {len(hrefs)} place links",
            search=search_query,
            search_index=search_index,
        )

        if not hrefs:
            await write_debug(page, f"no_results_search{search_index}")
            return [], 0

        extracted = 0
        for i, href in enumerate(hrefs[:MAX_RESULTS_PER_SEARCH], 1):
            try:
                await page.goto(href, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                await page.wait_for_timeout(900)

                if await detect_blocked(page):
                    await write_debug(page, f"blocked_place_search{search_index}_{i}")
                    await monitor.log_event("BLOCKED", "Blocked on place page", level="error", search=search_query)
                    break

                biz = await extract_business_details(page, page.url, search_index, monitor)
                if biz:
                    businesses.append(biz)
                    extracted += 1
                    await monitor.log_event(
                        "EXTRACT",
                        f"Extracted: {biz.title}",
                        search=search_query,
                        search_index=search_index,
                        businesses_extracted=extracted,
                    )
            except Exception as e:
                await monitor.log_event(
                    "EXTRACT_ERROR",
                    f"Error extracting place {i}: {e}",
                    search=search_query,
                    search_index=search_index,
                    level="warn",
                )

        await monitor.log_event(
            "SEARCH_COMPLETE",
            f"Completed search: {search_query} ({len(businesses)} businesses extracted)",
            search=search_query,
            search_index=search_index,
            businesses_extracted=len(businesses),
        )

        return businesses, len(businesses)

    except Exception as e:
        await write_debug(page, f"search_error_search{search_index}")
        await monitor.log_event("SEARCH_ERROR", f"Search error: {e}", search=search_query, search_index=search_index, level="error")
        return [], 0


async def insert_businesses_to_db(supabase_client, businesses: list[Business], monitor) -> tuple[int, int]:
    inserted = 0
    skipped = 0

    for b in businesses:
        data = {
            "title": b.title,
            "address": b.address,
            "phone_number": b.phone_number,
            "rating": b.rating,
            "webpage": b.webpage,
            "category": b.category,
            "working_hours": b.working_hours,
            "map_link": b.map_link,
        }

        try:
            supabase_client.table("Roofing Leads New").insert(data).execute()
            inserted += 1
            await monitor.log_event("INSERT", f"Inserted: {b.title}", level="info")
        except Exception as e:
            msg = str(e).lower()
            if "unique" in msg or "duplicate" in msg:
                skipped += 1
                await monitor.log_event("DUPLICATE", f"Skipped duplicate: {b.title}", level="warn")
            else:
                await monitor.log_event("INSERT_ERROR", f"Insert error for {b.title}: {e}", level="error")

    return inserted, skipped


async def mark_search_as_used(supabase_client, search_query: str, monitor) -> bool:
    try:
        supabase_client.table("Google_Maps Searches").update({"searchUSED": True}).eq("Searches", search_query).execute()
        await monitor.log_event("MARK_USED", f"Marked search as used: {search_query}", level="info")
        return True
    except Exception as e:
        await monitor.log_event("MARK_USED_ERROR", f"Error marking used: {e}", level="error")
        return False


async def main():
    results = {
        "status": "failed",
        "total_searches": 0,
        "searches_processed": 0,
        "businesses_extracted": 0,
        "businesses_inserted": 0,
        "businesses_skipped": 0,
        "searches_marked_used": 0,
        "errors": [],
        "timestamp": datetime.utcnow().isoformat(),
    }

    monitor = None

    try:
        monitor = build_monitor(supabase)
        await monitor.log_event("INIT", "Scraper initialized", level="info")

        searches_response = (
            supabase.table("Google_Maps Searches").select("Searches").eq("searchUSED", False).execute()
        )
        searches = [row["Searches"] for row in (searches_response.data or [])]
        results["total_searches"] = len(searches)

        if not searches:
            results["status"] = "completed"
            await monitor.update_progress(status="completed", searches_processed=0, total_searches=0)
            with open("scraper_results.json", "w") as f:
                json.dump(results, f, indent=2)
            return

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 800},
                locale="en-GB",
            )
            page = await context.new_page()
            page.set_default_timeout(ACTION_TIMEOUT_MS)

            total_extracted = 0
            total_inserted = 0
            total_skipped = 0
            searches_marked = 0

            for idx, search_query in enumerate(searches, 1):
                await monitor.update_progress(
                    status="running",
                    current_search=search_query,
                    current_search_index=idx,
                    total_searches=len(searches),
                    searches_processed=idx - 1,
                    businesses_extracted=total_extracted,
                    businesses_inserted=total_inserted,
                    businesses_skipped=total_skipped,
                    searches_marked_used=searches_marked,
                )

                businesses, extracted = await scrape_search(page, search_query, idx, len(searches), monitor)

                if businesses:
                    inserted, skipped = await insert_businesses_to_db(supabase, businesses, monitor)
                    total_extracted += extracted
                    total_inserted += inserted
                    total_skipped += skipped

                    # Mark search used ONLY if we got real results
                    if await mark_search_as_used(supabase, search_query, monitor):
                        searches_marked += 1

                results["searches_processed"] = idx
                results["businesses_extracted"] = total_extracted
                results["businesses_inserted"] = total_inserted
                results["businesses_skipped"] = total_skipped
                results["searches_marked_used"] = searches_marked

            await browser.close()

        results["status"] = "completed"
        await monitor.log_event(
            "COMPLETION",
            f"Scraper completed: {total_extracted} extracted, {total_inserted} inserted, {total_skipped} skipped",
            level="info",
        )
        await monitor.update_progress(
            status="completed",
            searches_processed=len(searches),
            total_searches=len(searches),
            businesses_extracted=total_extracted,
            businesses_inserted=total_inserted,
            businesses_skipped=total_skipped,
            searches_marked_used=searches_marked,
        )

    except Exception as e:
        msg = f"Fatal scraper error: {e}"
        results["errors"].append(msg)
        results["status"] = "failed"
        if monitor:
            await monitor.log_event("FATAL", msg, level="error")
            await monitor.update_progress(status="failed", error_message=msg)

    # Always write results for artifact upload
    with open("scraper_results.json", "w") as f:
        json.dump(results, f, indent=2)

    print("\n" + "=" * 60)
    print("Scraper Results: " + results["status"].upper())
    print("=" * 60)
    print(f"Total Searches: {results['total_searches']}")
    print(f"Searches Processed: {results['searches_processed']}")
    print(f"Businesses Extracted: {results['businesses_extracted']}")
    print(f"Businesses Inserted: {results['businesses_inserted']}")
    print(f"Businesses Skipped: {results['businesses_skipped']}")
    print(f"Searches Marked Used: {results['searches_marked_used']}")
    if results["errors"]:
        print(f"Errors ({len(results['errors'])}):")
        for err in results["errors"]:
            print(f"  - {err}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
