/**
 * Auto Business Finder Page
 *
 * What the user expects:
 * - Not just "running" vs "completed".
 * - They want to SEE what GitHub Actions / the scraper is doing:
 *   - initializing
 *   - which search is currently being processed
 *   - how many businesses were extracted and inserted
 *   - when searches are marked as used
 *   - when the run finishes or fails
 *
 * Implementation:
 * - We still trigger GitHub Actions via /api/trigger-scraper
 * - We now also poll /api/scraper-progress?runKey=... which reads a
 *   Supabase-backed monitoring timeline written by the scraper itself.
 */

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/layout/Sidebar'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Zap,
  ListChecks,
} from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

type UiStatus = 'idle' | 'initializing' | 'running' | 'completed' | 'error'

interface ScraperProgressRow {
  run_key: string
  github_run_id?: string | null
  status: 'initializing' | 'running' | 'completed' | 'failed'
  current_action?: string | null
  current_search?: string | null
  current_search_index?: number | null
  total_searches?: number | null
  businesses_extracted?: number | null
  businesses_inserted_or_skipped?: number | null
  searches_loaded_ok?: number | null
  searches_errors?: number | null
  searches_marked_used?: number | null
  searches_processed?: number | null
  error_message?: string | null
  started_at?: string | null
  updated_at?: string | null
  completed_at?: string | null
}

interface ScraperEventRow {
  id: number
  run_key: string
  level: 'info' | 'warn' | 'error'
  event_type: string
  message: string
  search?: string | null
  search_index?: number | null
  businesses_extracted?: number | null
  businesses_inserted_or_skipped?: number | null
  searches_marked_used?: number | null
  created_at: string
}

interface Business {
  id: string
  title: string
  address: string
  phone_number?: string | null
  rating?: string | null
  webpage?: string | null
  category?: string | null
  map_link?: string | null
  created_at: string
}

export default function AutoBusinessFinderPage() {
  const [uiStatus, setUiStatus] = useState<UiStatus>('idle')
  const [statusMessage, setStatusMessage] = useState(
    'Ready to start scraping. Click the button below to begin.'
  )
  const [isLoading, setIsLoading] = useState(false)

  // The stable identifier returned by /api/trigger-scraper (ISO timestamp)
  const [runKey, setRunKey] = useState<string | null>(null)

  // Optional: GitHub run id for link-out
  const [workflowId, setWorkflowId] = useState<string | null>(null)

  // Supabase-backed monitoring data
  const [progress, setProgress] = useState<ScraperProgressRow | null>(null)
  const [events, setEvents] = useState<ScraperEventRow[]>([])

  // Live businesses table
  const [businesses, setBusinesses] = useState<Business[]>([])

  // Keep track of polling interval so we can stop it
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Fetch live businesses from Supabase so the user sees rows being added.
   *
   * NOTE: This requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
   * to be configured (client-side).
   */
  const fetchLiveBusinesses = async () => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      if (!supabaseUrl || !supabaseKey) return

      const supabase = createClient(supabaseUrl, supabaseKey)
      const { data, error } = await supabase
        .from('Roofing Leads New')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (!error) setBusinesses((data as any) || [])
    } catch {
      // ignore - we still can show progress without businesses list
    }
  }

  /**
   * Poll Supabase monitoring API for detailed scraper progress + event timeline.
   */
  const fetchProgress = async (rk: string) => {
    const res = await fetch(`/api/scraper-progress?runKey=${encodeURIComponent(rk)}`)
    if (!res.ok) return

    const data = await res.json()
    setProgress(data.progress)
    setEvents(data.events || [])

    // Update UI status + message based on progress
    const p: ScraperProgressRow | null = data.progress

    if (!p) {
      setUiStatus('initializing')
      setStatusMessage('Scraper started. Waiting for first progress update…')
      return
    }

    if (p.status === 'failed') {
      setUiStatus('error')
      setStatusMessage(p.error_message || 'Scraper failed. Check timeline for details.')
      setIsLoading(false)
      return
    }

    if (p.status === 'completed') {
      setUiStatus('completed')
      setStatusMessage(
        `Completed: inserted/skipped ${p.businesses_inserted_or_skipped ?? 0} businesses. Marked used ${p.searches_marked_used ?? 0} searches.`
      )
      setIsLoading(false)
      // Stop polling once completed
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    // initializing/running
    setUiStatus(p.status === 'initializing' ? 'initializing' : 'running')

    const searchPart = p.current_search
      ? `Current search: “${p.current_search}” (${p.current_search_index ?? '?'}/${p.total_searches ?? '?'})`
      : 'Preparing search…'

    const counters = `Extracted: ${p.businesses_extracted ?? 0} • Inserted/skipped: ${
      p.businesses_inserted_or_skipped ?? 0
    } • Searches used: ${p.searches_marked_used ?? 0}`

    setStatusMessage(`${searchPart} • ${p.current_action || 'working'} • ${counters}`)
  }

  /**
   * Trigger the GitHub Actions scraper.
   */
  const handleStartScraper = async () => {
    setIsLoading(true)
    setUiStatus('initializing')

    // Stable run key used for monitoring.
    // Using ISO timestamp keeps it human readable + unique.
    const newRunKey = new Date().toISOString()
    setRunKey(newRunKey)

    setStatusMessage('Triggering GitHub Actions workflow…')

    try {
      const response = await fetch('/api/trigger-scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start_scraper',
          timestamp: newRunKey,
        }),
      })

      if (!response.ok) throw new Error(`API error: ${response.status}`)

      const data = await response.json()
      setWorkflowId(data.workflowId || null)
      setRunKey(data.runKey || newRunKey)

      setStatusMessage('Workflow dispatched. Waiting for scraper initialization…')

      // Start polling progress + businesses
      if (pollRef.current) clearInterval(pollRef.current)

      pollRef.current = setInterval(async () => {
        if (data.runKey) {
          await fetchProgress(data.runKey)
        } else {
          await fetchProgress(newRunKey)
        }
        await fetchLiveBusinesses()
      }, 5000)

      // Kick off immediately
      await fetchProgress(data.runKey || newRunKey)
      await fetchLiveBusinesses()
    } catch (e) {
      setUiStatus('error')
      setStatusMessage(
        `Error starting scraper: ${e instanceof Error ? e.message : 'Unknown error'}`
      )
      setIsLoading(false)
    }
  }

  const getStatusColor = () => {
    switch (uiStatus) {
      case 'initializing':
        return 'bg-purple-500/10 border-purple-500/20'
      case 'running':
        return 'bg-blue-500/10 border-blue-500/20'
      case 'completed':
        return 'bg-green-500/10 border-green-500/20'
      case 'error':
        return 'bg-red-500/10 border-red-500/20'
      default:
        return 'bg-slate-800/50 border-slate-700'
    }
  }

  const getStatusIcon = () => {
    switch (uiStatus) {
      case 'initializing':
        return <Clock className="text-purple-400 animate-spin" size={20} />
      case 'running':
        return <Clock className="text-blue-400 animate-spin" size={20} />
      case 'completed':
        return <CheckCircle className="text-green-400" size={20} />
      case 'error':
        return <AlertCircle className="text-red-400" size={20} />
      default:
        return <Zap className="text-slate-400" size={20} />
    }
  }

  // Progress % is computed from searches_processed / total_searches (not fixed 1000)
  const progressPct = useMemo(() => {
    const done = progress?.searches_processed ?? 0
    const total = progress?.total_searches ?? 0
    if (!total) return 0
    return Math.min(100, Math.round((done / total) * 100))
  }, [progress?.searches_processed, progress?.total_searches])

  const githubRunLink = useMemo(() => {
    const id = progress?.github_run_id || workflowId
    if (!id || id === 'unknown') return null
    return `https://github.com/rileywebboost-afk/UltimateLeadGen/actions/runs/${id}`
  }, [progress?.github_run_id, workflowId])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handleRefresh = async () => {
    if (runKey) await fetchProgress(runKey)
    await fetchLiveBusinesses()
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />

      <main className="lg:ml-64 p-4 lg:p-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Auto Business Finder
          </h1>
          <p className="text-slate-400">
            Scrape Google Maps for all generated searches and automatically store
            business data with deep, real-time workflow visibility.
          </p>
        </div>

        {/* Status Card */}
        <Card className={`border ${getStatusColor()} p-6 mb-6`}>
          <div className="flex items-start gap-4">
            <div className="mt-1">{getStatusIcon()}</div>
            <div className="flex-1">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">
                    Scraper Status
                  </h3>
                  <p className="text-slate-300 mb-2">{statusMessage}</p>

                  {runKey && (
                    <p className="text-xs text-slate-500">
                      Run Key: <span className="text-slate-300">{runKey}</span>
                    </p>
                  )}

                  {githubRunLink && (
                    <a
                      className="text-xs text-blue-400 hover:text-blue-300"
                      href={githubRunLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View GitHub Run →
                    </a>
                  )}
                </div>

                <Button
                  onClick={handleRefresh}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  <RefreshCw size={16} />
                  Refresh
                </Button>
              </div>

              {/* Progress Bar */}
              {progress?.total_searches ? (
                <div className="mt-4">
                  <div className="flex justify-between text-sm text-slate-400 mb-2">
                    <span>Search Progress</span>
                    <span>
                      {progress.searches_processed ?? 0} /{' '}
                      {progress.total_searches ?? 0} ({progressPct}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3">
                      <div className="text-xs text-slate-500">Extracted</div>
                      <div className="text-white font-semibold">
                        {progress.businesses_extracted ?? 0}
                      </div>
                    </div>
                    <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3">
                      <div className="text-xs text-slate-500">Inserted/Skipped</div>
                      <div className="text-white font-semibold">
                        {progress.businesses_inserted_or_skipped ?? 0}
                      </div>
                    </div>
                    <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3">
                      <div className="text-xs text-slate-500">Searches Used</div>
                      <div className="text-white font-semibold">
                        {progress.searches_marked_used ?? 0}
                      </div>
                    </div>
                    <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-3">
                      <div className="text-xs text-slate-500">Errors</div>
                      <div className="text-white font-semibold">
                        {progress.searches_errors ?? 0}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {progress?.updated_at && (
                <p className="text-xs text-slate-500 mt-3">
                  Last updated: {new Date(progress.updated_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Start Card */}
        <Card className="bg-slate-900 border-slate-800 p-8 mb-6">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white mb-2">
              Start Google Maps Scraper
            </h2>
            <p className="text-slate-400">
              Triggers a GitHub Actions workflow that scrapes Google Maps.
              This page will now show a live timeline of what the workflow is
              doing.
            </p>
          </div>

          <Button
            onClick={handleStartScraper}
            disabled={isLoading || uiStatus === 'running' || uiStatus === 'initializing'}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {isLoading || uiStatus === 'running' || uiStatus === 'initializing'
              ? 'Scraper Running…'
              : 'Start Google Maps Scraper'}
          </Button>
        </Card>

        {/* Live Timeline */}
        <Card className="bg-slate-900 border-slate-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ListChecks className="text-slate-300" size={18} />
              <h2 className="text-xl font-bold text-white">Live Timeline</h2>
            </div>
            <div className="text-xs text-slate-500">
              Showing last {events.length} events
            </div>
          </div>

          {events.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              Timeline will populate once the workflow begins writing progress.
            </div>
          ) : (
            <div className="space-y-2">
              {events.slice(0, 12).map((evt) => (
                <div
                  key={evt.id}
                  className="flex items-start justify-between gap-3 bg-slate-950/40 border border-slate-800 rounded-lg p-3"
                >
                  <div>
                    <div className="text-sm text-white">
                      <span className="text-slate-400">[{evt.event_type}]</span>{' '}
                      {evt.message}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {new Date(evt.created_at).toLocaleString()}
                      {evt.search ? ` • ${evt.search}` : ''}
                    </div>
                  </div>
                  <div
                    className={`text-xs px-2 py-1 rounded border ${
                      evt.level === 'error'
                        ? 'border-red-500/30 bg-red-500/10 text-red-300'
                        : evt.level === 'warn'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                          : 'border-slate-700 bg-slate-900/30 text-slate-300'
                    }`}
                  >
                    {evt.level}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Live Results */}
        <Card className="bg-slate-900 border-slate-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">
              Live Results ({businesses.length})
            </h2>
            <Button
              onClick={fetchLiveBusinesses}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RefreshCw size={16} />
              Refresh
            </Button>
          </div>

          {businesses.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-400">
                No businesses found yet. Start the scraper to see results appear
                here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold">
                      Business Name
                    </th>
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold">
                      Address
                    </th>
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold">
                      Phone
                    </th>
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold">
                      Rating
                    </th>
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold">
                      Category
                    </th>
                    <th className="text-left py-3 px-4 text-slate-300 font-semibold">
                      Website
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {businesses.map((b) => (
                    <tr
                      key={b.id}
                      className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-3 px-4 text-slate-200">{b.title}</td>
                      <td className="py-3 px-4 text-slate-400 text-xs">
                        {b.address}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {b.phone_number || '-'}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {b.rating ? `${b.rating}★` : '-'}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {b.category || '-'}
                      </td>
                      <td className="py-3 px-4">
                        {b.webpage ? (
                          <a
                            href={b.webpage}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-400 hover:text-blue-300"
                          >
                            Visit
                          </a>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  )
}
