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
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any, Optional

from playwright.async_api import async_playwright, Page, TimeoutError as PwTimeout
from supabase import create_client

# Monitoring: write real-time progress + event timeline to Supabase
# Use sys.path to handle both local dev and GitHub Actions contexts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scraper_monitor import build_monitor


# ----------------------------
# Config
# ----------------------------
MAX_RESULTS_PER_SEARCH = int(os.getenv("MAX_RESULTS_PER_SEARCH", "20"))
NAV_TIMEOUT_MS = int(os.getenv("NAV_TIMEOUT_MS", "90000"))  # Google Maps can be slow
ACTION_TIMEOUT_MS = int(os.getenv("ACTION_TIMEOUT_MS", "20000"))

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
RUN_KEY = os.getenv("RUN_KEY", datetime.utcnow().isoformat())
GITHUB_RUN_ID = os.getenv("GITHUB_RUN_ID", "unknown")


# ----------------------------
# Data Models
# ----------------------------
@dataclass
class Business:
    """Extracted business data from Google Maps listing."""

    title: str
    address: str
    phone_number: Optional[str] = None
    rating: Optional[str] = None
    webpage: Optional[str] = None
    category: Optional[str] = None
    working_hours: Optional[str] = None
    map_link: Optional[str] = None
    cover_image: Optional[str] = None


# ----------------------------
# Supabase Client
# ----------------------------
def get_supabase_client():
    """Initialize Supabase client."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# ----------------------------
# Scraper Logic
# ----------------------------
async def extract_business_details(page: Page, listing_url: str) -> Optional[Business]:
    """
    Extract business details from a Google Maps listing page.

    Args:
        page: Playwright page object
        listing_url: URL of the listing

    Returns:
        Business object or None if extraction fails
    """
    try:
        await page.goto(listing_url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        await page.wait_for_timeout(1000)  # Let page settle

        # Extract title
        title_selector = 'h1[data-attrid="title"]'
        title_elem = await page.query_selector(title_selector)
        title = (await title_elem.text_content()).strip() if title_elem else "Unknown"

        # Extract address
        address_selector = 'button[data-item-id="address"]'
        address_elem = await page.query_selector(address_selector)
        address = (await address_elem.text_content()).strip() if address_elem else ""

        # Extract phone
        phone_selector = 'button[data-item-id="phone:tel"]'
        phone_elem = await page.query_selector(phone_selector)
        phone = (await phone_elem.text_content()).strip() if phone_elem else None

        # Extract rating
        rating_selector = 'div[role="img"][aria-label*="stars"]'
        rating_elem = await page.query_selector(rating_selector)
        rating = None
        if rating_elem:
            aria_label = await rating_elem.get_attribute("aria-label")
            if aria_label:
                match = re.search(r"([\d.]+)\s*star", aria_label)
                rating = match.group(1) if match else None

        # Extract website
        website_selector = 'a[data-item-id="website"]'
        website_elem = await page.query_selector(website_selector)
        website = await website_elem.get_attribute("href") if website_elem else None

        # Extract category
        category_selector = 'button[jsname="x8hlje"]'
        category_elem = await page.query_selector(category_selector)
        category = (await category_elem.text_content()).strip() if category_elem else None

        # Extract working hours
        hours_selector = 'div[data-item-id="oh"]'
        hours_elem = await page.query_selector(hours_selector)
        working_hours = (await hours_elem.text_content()).strip() if hours_elem else None

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
        print(f"Error extracting business details from {listing_url}: {e}")
        return None


async def scrape_search(
    page: Page, search_query: str, search_index: int, total_searches: int, monitor
) -> tuple[list[Business], int]:
    """
    Scrape Google Maps for a single search query.

    Args:
        page: Playwright page object
        search_query: Search query to execute
        search_index: Current search index (for progress tracking)
        total_searches: Total number of searches
        monitor: Monitor object for logging progress

    Returns:
        Tuple of (businesses list, count of businesses extracted)
    """
    businesses = []
    extracted_count = 0

    try:
        # Log search start
        await monitor.log_event(
            "SEARCH_START",
            f"Starting search: {search_query}",
            search=search_query,
            search_index=search_index,
        )

        # Navigate to Google Maps search
        search_url = f"https://www.google.com/maps/search/{search_query.replace(' ', '+')}"
        await page.goto(search_url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        await page.wait_for_timeout(2000)

        # Wait for listing cards to appear
        listing_selector = 'div[role="button"][jsaction*="click"]'
        await page.wait_for_selector(listing_selector, timeout=ACTION_TIMEOUT_MS)

        # Get all listing cards
        listings = await page.query_selector_all(listing_selector)
        listings_count = len(listings)

        await monitor.log_event(
            "LISTINGS_FOUND",
            f"Found {listings_count} listings for search: {search_query}",
            search=search_query,
            search_index=search_index,
        )

        # Extract details from each listing (limit to MAX_RESULTS_PER_SEARCH)
        for i, listing in enumerate(listings[: MAX_RESULTS_PER_SEARCH]):
            try:
                # Click listing to open details
                await listing.click()
                await page.wait_for_timeout(1500)

                # Get listing URL
                listing_url = page.url

                # Extract business details
                business = await extract_business_details(page, listing_url)
                if business:
                    businesses.append(business)
                    extracted_count += 1

                    await monitor.log_event(
                        "EXTRACT",
                        f"Extracted: {business.title}",
                        search=search_query,
                        search_index=search_index,
                        businesses_extracted=extracted_count,
                    )

            except Exception as e:
                await monitor.log_event(
                    "EXTRACT_ERROR",
                    f"Error extracting listing {i + 1}: {str(e)}",
                    search=search_query,
                    search_index=search_index,
                    level="warn",
                )
                continue

        await monitor.log_event(
            "SEARCH_COMPLETE",
            f"Completed search: {search_query} ({extracted_count} businesses extracted)",
            search=search_query,
            search_index=search_index,
            businesses_extracted=extracted_count,
        )

        return businesses, extracted_count

    except Exception as e:
        await monitor.log_event(
            "SEARCH_ERROR",
            f"Error during search '{search_query}': {str(e)}",
            search=search_query,
            search_index=search_index,
            level="error",
        )
        return [], 0


async def insert_businesses_to_db(
    supabase, businesses: list[Business], monitor
) -> tuple[int, int]:
    """
    Insert businesses into Supabase, handling duplicates.

    Args:
        supabase: Supabase client
        businesses: List of Business objects to insert
        monitor: Monitor object for logging

    Returns:
        Tuple of (inserted count, skipped count)
    """
    inserted = 0
    skipped = 0

    for business in businesses:
        try:
            # Check if business already exists (by title)
            existing = supabase.table("Roofing Leads New").select("id").eq("title", business.title).execute()

            if existing.data:
                skipped += 1
                await monitor.log_event(
                    "DB_SKIP",
                    f"Skipped duplicate: {business.title}",
                    level="info",
                )
            else:
                # Insert new business
                supabase.table("Roofing Leads New").insert(asdict(business)).execute()
                inserted += 1
                await monitor.log_event(
                    "DB_INSERT",
                    f"Inserted: {business.title}",
                    level="info",
                )

        except Exception as e:
            await monitor.log_event(
                "DB_ERROR",
                f"Error inserting business '{business.title}': {str(e)}",
                level="error",
            )
            skipped += 1

    return inserted, skipped


async def mark_search_as_used(supabase, search_query: str, monitor) -> bool:
    """
    Mark a search as used in the database.

    Args:
        supabase: Supabase client
        search_query: Search query to mark as used
        monitor: Monitor object for logging

    Returns:
        True if successful, False otherwise
    """
    try:
        supabase.table("Google_Maps Searches").update({"searchUSED": True}).eq("Searches", search_query).execute()
        await monitor.log_event(
            "SEARCH_MARKED_USED",
            f"Marked search as used: {search_query}",
            level="info",
        )
        return True
    except Exception as e:
        await monitor.log_event(
            "MARK_USED_ERROR",
            f"Error marking search as used '{search_query}': {str(e)}",
            level="error",
        )
        return False


async def main():
    """Main scraper entry point."""
    supabase = get_supabase_client()
    monitor = build_monitor(supabase)

    results = {
        "run_key": RUN_KEY,
        "github_run_id": GITHUB_RUN_ID,
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

    try:
        # Log initialization
        await monitor.log_event("INIT", "Scraper initialized", level="info")

        # Fetch unused searches from Supabase
        await monitor.log_event("FETCH_SEARCHES", "Fetching unused searches from database", level="info")

        searches_response = supabase.table("Google_Maps Searches").select("Searches").eq("searchUSED", False).execute()

        searches = [row["Searches"] for row in searches_response.data] if searches_response.data else []
        results["total_searches"] = len(searches)

        if not searches:
            await monitor.log_event("NO_SEARCHES", "No unused searches found", level="warn")
            results["status"] = "completed"
            results["searches_processed"] = 0
            monitor.update_progress(
                status="completed",
                searches_processed=0,
                total_searches=0,
            )
        else:
            await monitor.log_event(
                "SEARCHES_LOADED",
                f"Loaded {len(searches)} unused searches",
                level="info",
            )

            # Launch browser
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()

                total_extracted = 0
                total_inserted = 0
                total_skipped = 0
                searches_marked = 0

                # Process each search
                for idx, search_query in enumerate(searches, 1):
                    try:
                        # Update progress
                        monitor.update_progress(
                            status="running",
                            current_search=search_query,
                            current_search_index=idx,
                            total_searches=len(searches),
                            searches_processed=idx - 1,
                        )

                        # Scrape search
                        businesses, extracted = await scrape_search(page, search_query, idx, len(searches), monitor)

                        if businesses:
                            # Insert to database
                            inserted, skipped = await insert_businesses_to_db(supabase, businesses, monitor)
                            total_extracted += extracted
                            total_inserted += inserted
                            total_skipped += skipped

                            # Mark search as used
                            if await mark_search_as_used(supabase, search_query, monitor):
                                searches_marked += 1

                        results["searches_processed"] = idx
                        results["businesses_extracted"] = total_extracted
                        results["businesses_inserted"] = total_inserted
                        results["businesses_skipped"] = total_skipped
                        results["searches_marked_used"] = searches_marked

                    except Exception as e:
                        error_msg = f"Error processing search '{search_query}': {str(e)}"
                        results["errors"].append(error_msg)
                        await monitor.log_event(
                            "SEARCH_FATAL",
                            error_msg,
                            search=search_query,
                            search_index=idx,
                            level="error",
                        )

                await browser.close()

            results["status"] = "completed"

            # Final progress update
            monitor.update_progress(
                status="completed",
                searches_processed=len(searches),
                total_searches=len(searches),
                businesses_extracted=total_extracted,
                businesses_inserted_or_skipped=total_inserted + total_skipped,
                searches_marked_used=searches_marked,
            )

            await monitor.log_event(
                "COMPLETE",
                f"Scraper completed: {total_extracted} extracted, {total_inserted} inserted, {total_skipped} skipped, {searches_marked} searches marked used",
                level="info",
            )

    except Exception as e:
        error_msg = f"Fatal scraper error: {str(e)}"
        results["status"] = "failed"
        results["errors"].append(error_msg)

        await monitor.log_event("FATAL", error_msg, level="error")
        monitor.update_progress(status="failed", error_message=error_msg)

    finally:
        # Write results to file for artifact upload
        with open("scraper_results.json", "w") as f:
            json.dump(results, f, indent=2)

        print(f"\n{'='*60}")
        print(f"Scraper Results: {results['status'].upper()}")
        print(f"{'='*60}")
        print(f"Total Searches: {results['total_searches']}")
        print(f"Searches Processed: {results['searches_processed']}")
        print(f"Businesses Extracted: {results['businesses_extracted']}")
        print(f"Businesses Inserted: {results['businesses_inserted']}")
        print(f"Businesses Skipped: {results['businesses_skipped']}")
        print(f"Searches Marked Used: {results['searches_marked_used']}")
        if results["errors"]:
            print(f"\nErrors ({len(results['errors'])}):")
            for error in results["errors"]:
                print(f"  - {error}")
        print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
