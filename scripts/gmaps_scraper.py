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


# ----------------------------
# Supabase Client
# ----------------------------
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# ----------------------------
# Business Extraction
# ----------------------------
async def extract_business_details(page: Page, listing_url: str) -> Optional[Business]:
    """
    Extract business details from a Google Maps listing detail page.
    
    Uses multiple selector strategies to handle DOM variations.
    Logs extraction attempts for debugging.
    
    Args:
        page: Playwright page object
        listing_url: URL of the listing
        
    Returns:
        Business object or None if extraction fails
    """
    try:
        # Wait for page to load
        await page.wait_for_timeout(1000)
        
        # Extract title - try multiple selectors
        title = None
        title_selectors = [
            'h1',  # Primary heading
            'div[role="heading"]',  # Heading role
            'div.fontHeadlineSmall',  # Google Maps class
        ]
        for selector in title_selectors:
            try:
                elem = await page.query_selector(selector)
                if elem:
                    text = await elem.text_content()
                    if text and text.strip():
                        title = text.strip()
                        break
            except:
                continue
        
        if not title:
            print(f"  ⚠️  Could not extract title from {listing_url}")
            return None
        
        # Extract address - try multiple selectors
        address = ""
        address_selectors = [
            'button[data-item-id="address"]',
            'div[data-item-id="address"]',
            'button[aria-label*="address"]',
            'div.fontBodyMedium:has-text("Address")',
        ]
        for selector in address_selectors:
            try:
                elem = await page.query_selector(selector)
                if elem:
                    text = await elem.text_content()
                    if text and text.strip():
                        address = text.strip()
                        break
            except:
                continue
        
        # Extract phone - try multiple selectors
        phone = None
        phone_selectors = [
            'button[data-item-id="phone:tel"]',
            'a[data-item-id="phone:tel"]',
            'button[aria-label*="phone"]',
            'a[href^="tel:"]',
        ]
        for selector in phone_selectors:
            try:
                elem = await page.query_selector(selector)
                if elem:
                    text = await elem.text_content()
                    if text and text.strip():
                        phone = text.strip()
                        break
            except:
                continue
        
        # Extract rating - try multiple selectors
        rating = None
        rating_selectors = [
            'div[role="img"][aria-label*="stars"]',
            'div[aria-label*="star"]',
            'span.fontBodyMedium:has-text("★")',
        ]
        for selector in rating_selectors:
            try:
                elem = await page.query_selector(selector)
                if elem:
                    aria_label = await elem.get_attribute("aria-label")
                    if aria_label:
                        match = re.search(r"([\d.]+)\s*star", aria_label)
                        if match:
                            rating = match.group(1)
                            break
            except:
                continue
        
        # Extract website - try multiple selectors
        website = None
        website_selectors = [
            'a[data-item-id="website"]',
            'a[aria-label*="website"]',
            'a[href*="http"]:not([href*="google.com"])',
        ]
        for selector in website_selectors:
            try:
                elem = await page.query_selector(selector)
                if elem:
                    href = await elem.get_attribute("href")
                    if href and href.strip():
                        website = href.strip()
                        break
            except:
                continue
        
        # Extract category
        category = None
        try:
            elem = await page.query_selector('button[jsname="x8hlje"]')
            if elem:
                text = await elem.text_content()
                if text:
                    category = text.strip()
        except:
            pass
        
        # Extract working hours
        working_hours = None
        try:
            elem = await page.query_selector('div[data-item-id="oh"]')
            if elem:
                text = await elem.text_content()
                if text:
                    working_hours = text.strip()
        except:
            pass
        
        # Create business object
        business = Business(
            title=title,
            address=address,
            phone_number=phone,
            rating=rating,
            webpage=website,
            category=category,
            working_hours=working_hours,
            map_link=listing_url,
        )
        
        print(f"  ✓ Extracted: {title}")
        return business
        
    except Exception as e:
        print(f"  ✗ Error extracting from {listing_url}: {str(e)}")
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
        print(f"\n[{search_index}/{total_searches}] Searching: {search_query}")
        print(f"  URL: {search_url}")
        
        await page.goto(search_url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
        await page.wait_for_timeout(2000)

        # Wait for listing cards to appear - try multiple selectors
        listing_selector = None
        listing_selectors = [
            'div[role="button"][jsaction*="click"]',  # Primary selector
            'div[role="button"]',  # Fallback: any button role
            'div.Nv2PK',  # Google Maps listing class
            'div[data-item-id]',  # Data attribute selector
        ]
        
        listings = []
        for selector in listing_selectors:
            try:
                await page.wait_for_selector(selector, timeout=5000)
                listings = await page.query_selector_all(selector)
                if listings:
                    listing_selector = selector
                    print(f"  Found listings with selector: {selector}")
                    break
            except PwTimeout:
                continue
            except Exception as e:
                print(f"  Error with selector {selector}: {e}")
                continue
        
        listings_count = len(listings)
        print(f"  Found {listings_count} listings")

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
            # Prepare data for insertion
            data = {
                "title": business.title,
                "address": business.address,
                "phone_number": business.phone_number,
                "rating": business.rating,
                "webpage": business.webpage,
                "category": business.category,
                "working_hours": business.working_hours,
                "map_link": business.map_link,
            }

            # Insert into database
            response = supabase.table("Roofing Leads New").insert(data).execute()
            inserted += 1

            await monitor.log_event(
                "INSERT",
                f"Inserted: {business.title}",
                level="info",
            )

        except Exception as e:
            # Check if it's a duplicate (unique constraint violation)
            if "unique constraint" in str(e).lower() or "duplicate" in str(e).lower():
                skipped += 1
                await monitor.log_event(
                    "DUPLICATE",
                    f"Skipped duplicate: {business.title}",
                    level="warn",
                )
            else:
                await monitor.log_event(
                    "INSERT_ERROR",
                    f"Error inserting {business.title}: {str(e)}",
                    level="error",
                )

    return inserted, skipped


async def mark_search_as_used(supabase, search_query: str, monitor) -> bool:
    """
    Mark a search as used in the database.

    Args:
        supabase: Supabase client
        search_query: The search query to mark as used
        monitor: Monitor object for logging

    Returns:
        True if successful, False otherwise
    """
    try:
        supabase.table("Google_Maps Searches").update({"searchUSED": True}).eq(
            "Searches", search_query
        ).execute()

        await monitor.log_event(
            "MARK_USED",
            f"Marked search as used: {search_query}",
            level="info",
        )
        return True

    except Exception as e:
        await monitor.log_event(
            "MARK_USED_ERROR",
            f"Error marking search as used: {str(e)}",
            level="error",
        )
        return False


# ----------------------------
# Main Scraper
# ----------------------------
async def main():
    """Main scraper function."""
    
    # Initialize results tracking
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

    try:
        # Initialize monitor
        monitor = build_monitor(supabase)
        
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
            await monitor.update_progress(
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
                        await monitor.update_progress(
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
                            "SEARCH_PROCESS_ERROR",
                            error_msg,
                            level="error",
                        )
                        continue

                # Close browser
                await browser.close()

            # Mark as completed
            results["status"] = "completed"
            await monitor.log_event(
                "COMPLETION",
                f"Scraper completed: {total_extracted} businesses extracted, {total_inserted} inserted",
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
        error_msg = f"Fatal scraper error: {str(e)}"
        results["errors"].append(error_msg)
        results["status"] = "failed"
        await monitor.log_event("FATAL", error_msg, level="error")
        await monitor.update_progress(status="failed", error_message=error_msg)

    # Write results to file for artifact upload
    with open("scraper_results.json", "w") as f:
        json.dump(results, f, indent=2)

    # Print summary
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
        for error in results["errors"]:
            print(f"  - {error}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
