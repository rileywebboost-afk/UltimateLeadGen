/**
 * API Route: Get Scraper Status
 * 
 * Polls GitHub Actions workflow status and returns progress information
 * Also fetches live lead count from database for real-time progress tracking
 * 
 * GET /api/scraper-status?workflowId=123456
 * Response: { status: 'running'|'completed'|'failed', businessesFound?: number, error?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    const workflowId = request.nextUrl.searchParams.get('workflowId')

    if (!workflowId) {
      return NextResponse.json(
        { error: 'workflowId parameter required' },
        { status: 400 }
      )
    }

    // Get GitHub token from environment
    const githubToken = process.env.GH_TOKEN
    if (!githubToken) {
      return NextResponse.json(
        { error: 'GitHub token not configured' },
        { status: 500 }
      )
    }

    /**
     * Fetch workflow run status from GitHub API
     * This checks if the scraper workflow is still running, completed, or failed
     */
    const statusResponse = await fetch(
      `https://api.github.com/repos/rileywebboost-afk/UltimateLeadGen/actions/runs/${workflowId}`,
      {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    )

    if (!statusResponse.ok) {
      return NextResponse.json(
        { status: 'unknown', error: 'Failed to fetch workflow status' },
        { status: 500 }
      )
    }

    const workflowData = await statusResponse.json()

    /**
     * Fetch live lead count from Supabase
     * This gives real-time progress as businesses are being scraped
     */
    let businessesFound = 0
    try {
      const supabaseUrl = process.env.SUPABASE_URL
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey)
        const { count, error } = await supabase
          .from('Roofing Leads New')
          .select('*', { count: 'exact', head: true })

        if (!error && count !== null) {
          businessesFound = count
        }
      }
    } catch (error) {
      console.error('Error fetching lead count:', error)
      // Continue without lead count - not critical
    }

    /**
     * Map GitHub workflow status to our status values
     * GitHub statuses: queued, in_progress, completed
     * GitHub conclusions: success, failure, neutral, cancelled, skipped, timed_out, action_required
     */
    let status = 'running'
    let error = undefined

    if (workflowData.status === 'completed') {
      if (workflowData.conclusion === 'success') {
        status = 'completed'
      } else {
        status = 'failed'
        error = `Workflow failed with conclusion: ${workflowData.conclusion}`
      }
    }

    return NextResponse.json({
      status,
      businessesFound,
      error,
      workflowStatus: workflowData.status,
      conclusion: workflowData.conclusion,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching scraper status:', error)
    return NextResponse.json(
      { status: 'error', error: 'Internal server error' },
      { status: 500 }
    )
  }
}
