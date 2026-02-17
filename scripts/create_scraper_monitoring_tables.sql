-- =====================================================================
-- Scraper Monitoring Tables (Supabase SQL)
-- =====================================================================
-- Purpose:
-- These tables enable real-time visibility into what the GitHub Actions
-- scraper is doing (initializing, scraping each search, inserting leads,
-- marking searches as used, completion/failure).
--
-- How to apply:
-- 1) Open Supabase Dashboard → SQL Editor
-- 2) Paste this file contents
-- 3) Run
--
-- Notes:
-- - We use `run_key` as the stable ID. In this project, `run_key` is set to
--   the workflow_dispatch input timestamp that the app sends.
-- - Enable Realtime later if you want push updates (polling works fine too).
-- =====================================================================

-- -----------------------------
-- High-level run/progress row
-- -----------------------------
CREATE TABLE IF NOT EXISTS public.scraper_progress (
  id BIGSERIAL PRIMARY KEY,

  -- A stable identifier we control from the app
  -- We set this to the workflow_dispatch input timestamp (RUN_KEY)
  run_key TEXT NOT NULL UNIQUE,

  -- GitHub run id is useful but optional (nice for linking out)
  github_run_id TEXT,

  status TEXT NOT NULL, -- 'initializing' | 'running' | 'completed' | 'failed'
  current_action TEXT,

  current_search TEXT,
  current_search_index INT,
  total_searches INT,

  businesses_extracted INT DEFAULT 0,
  businesses_inserted_or_skipped INT DEFAULT 0,

  searches_loaded_ok INT DEFAULT 0,
  searches_errors INT DEFAULT 0,
  searches_marked_used INT DEFAULT 0,
  searches_processed INT DEFAULT 0,

  error_message TEXT,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scraper_progress_updated_at ON public.scraper_progress(updated_at DESC);

-- Needed for Supabase Realtime
ALTER TABLE public.scraper_progress REPLICA IDENTITY FULL;


-- -----------------------------
-- Event stream (append-only)
-- -----------------------------
CREATE TABLE IF NOT EXISTS public.scraper_events (
  id BIGSERIAL PRIMARY KEY,
  run_key TEXT NOT NULL,

  -- Optional linkage to GitHub run id
  github_run_id TEXT,

  level TEXT NOT NULL DEFAULT 'info', -- 'info' | 'warn' | 'error'
  event_type TEXT NOT NULL, -- e.g. 'INIT', 'SEARCH_START', 'LEADS_INSERTED', ...
  message TEXT NOT NULL,

  search TEXT,
  search_index INT,

  businesses_extracted INT,
  businesses_inserted_or_skipped INT,
  searches_marked_used INT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraper_events_run_key_created_at ON public.scraper_events(run_key, created_at DESC);

-- Needed for Supabase Realtime
ALTER TABLE public.scraper_events REPLICA IDENTITY FULL;
