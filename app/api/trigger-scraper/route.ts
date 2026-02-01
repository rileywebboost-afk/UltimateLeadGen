/**
 * API Route: Trigger GitHub Actions Scraper
 *
 * IMPORTANT:
 * - GitHub workflow dispatch returns 204 and does NOT directly give a run id.
 * - We need a stable identifier to correlate UI ↔ GitHub Actions ↔ scraper.
 *
 * Approach:
 * - The web app sends a timestamp ISO string (we generate it here if missing)
 * - We pass that timestamp into the workflow as workflow_dispatch input
 * - In the workflow we pass it as RUN_KEY env var
 * - The scraper writes real-time progress rows into Supabase under run_key
 *
 * POST /api/trigger-scraper
 * Body: { action: 'start_scraper', timestamp?: ISO string }
 * Response: { success: boolean, workflowId: string, runKey: string, message: string }
 */

import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate request
    if (body.action !== 'start_scraper') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    // Stable key to correlate UI with Supabase monitoring rows
    const runKey: string = body.timestamp || new Date().toISOString()

    // Get GitHub token from environment
    const githubToken = process.env.GH_TOKEN
    if (!githubToken) {
      return NextResponse.json(
        { error: 'GitHub token not configured' },
        { status: 500 }
      )
    }

    // 1) Trigger workflow dispatch
    const workflowResponse = await fetch(
      'https://api.github.com/repos/rileywebboost-afk/UltimateLeadGen/actions/workflows/scraper.yml/dispatches',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            action: 'start_scraper',
            timestamp: runKey,
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

    // 2) Best-effort: fetch latest in-progress run (may not exist immediately)
    // NOTE: this is only for linking to GitHub. Real progress comes from Supabase run_key.
    let workflowId = 'unknown'
    try {
      const runsResponse = await fetch(
        'https://api.github.com/repos/rileywebboost-afk/UltimateLeadGen/actions/runs?per_page=5&head_branch=main',
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      )

      const runsData = await runsResponse.json()
      // pick the most recent run that is queued/in_progress
      const run = (runsData.workflow_runs || []).find(
        (r: any) => r.status === 'in_progress' || r.status === 'queued'
      )
      workflowId = run?.id ? String(run.id) : 'unknown'
    } catch (e) {
      // ignore
    }

    return NextResponse.json({
      success: true,
      workflowId,
      runKey,
      message: 'Scraper workflow triggered successfully',
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error triggering scraper:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
