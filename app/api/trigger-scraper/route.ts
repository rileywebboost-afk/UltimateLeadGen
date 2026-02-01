/**
 * API Route: Trigger GitHub Actions Scraper
 * 
 * This endpoint triggers a GitHub Actions workflow that:
 * 1. Fetches all unused searches from Supabase "Google_Maps Searches" table
 * 2. Uses headless Playwright browser to scrape Google Maps for each search
 * 3. Extracts business data (title, address, phone, rating, website, etc.)
 * 4. Stores results in Supabase "Roofing Leads New" table
 * 5. Updates searchUSED flag to true for processed searches
 * 
 * POST /api/trigger-scraper
 * Body: { action: 'start_scraper', timestamp: ISO string }
 * Response: { success: boolean, workflowId: string, message: string }
 */

import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate request
    if (body.action !== 'start_scraper') {
      return NextResponse.json(
        { error: 'Invalid action' },
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
     * Trigger GitHub Actions workflow dispatch
     * This calls the GitHub API to start the scraper workflow
     * The workflow will run in GitHub Actions with headless browser
     */
    const workflowResponse = await fetch(
      'https://api.github.com/repos/Halfpro6119/UltimateLeadGen/actions/workflows/scraper.yml/dispatches',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            action: 'start_scraper',
            timestamp: body.timestamp,
          },
        }),
      }
    )

    if (!workflowResponse.ok) {
      const error = await workflowResponse.text()
      console.error('GitHub API error:', error)
      return NextResponse.json(
        { error: 'Failed to trigger workflow' },
        { status: 500 }
      )
    }

    /**
     * Get the workflow run ID for status tracking
     * This allows the frontend to poll for progress updates
     */
    const runsResponse = await fetch(
      'https://api.github.com/repos/Halfpro6119/UltimateLeadGen/actions/runs?status=in_progress&head_branch=main',
      {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    )

    const runsData = await runsResponse.json()
    const workflowId = runsData.workflow_runs?.[0]?.id || 'unknown'

    return NextResponse.json({
      success: true,
      workflowId,
      message: 'Scraper workflow triggered successfully',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error triggering scraper:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
