/**
 * API Route: Get Scraper Progress (Supabase)
 *
 * Why this exists:
 * GitHub Actions status alone only tells us queued/in_progress/completed.
 * It does NOT tell the UI what the scraper is doing inside the workflow.
 *
 * This endpoint reads the real-time progress row + recent event timeline
 * from Supabase tables:
 * - public.scraper_progress (1 row per run_key)
 * - public.scraper_events   (append-only timeline)
 *
 * GET /api/scraper-progress?runKey=ISO_TIMESTAMP
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  try {
    const runKey = req.nextUrl.searchParams.get('runKey')

    if (!runKey) {
      return NextResponse.json(
        { error: 'runKey query parameter is required' },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase server credentials not configured' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch progress row (single)
    const { data: progress, error: progressError } = await supabase
      .from('scraper_progress')
      .select('*')
      .eq('run_key', runKey)
      .maybeSingle()

    if (progressError) {
      return NextResponse.json(
        { error: 'Failed to fetch progress', details: progressError.message },
        { status: 500 }
      )
    }

    // Fetch recent events (last 50)
    const { data: events, error: eventsError } = await supabase
      .from('scraper_events')
      .select('*')
      .eq('run_key', runKey)
      .order('created_at', { ascending: false })
      .limit(50)

    if (eventsError) {
      return NextResponse.json(
        { error: 'Failed to fetch events', details: eventsError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      runKey,
      progress: progress || null,
      events: events || [],
      updatedAt: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
