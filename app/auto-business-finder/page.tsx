/**
 * Auto Business Finder Page
 * Scrapes Google Maps for all generated searches and stores business data
 * Displays real-time results as they're being scraped
 * Integrates with GitHub Actions for headless browser automation
 */

'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/layout/Sidebar'
import { AlertCircle, CheckCircle, Clock, Zap, RefreshCw } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

interface ScraperStatus {
  status: 'idle' | 'running' | 'completed' | 'error'
  message: string
  progress?: {
    completed: number
    total: number
  }
  timestamp?: string
}

interface Business {
  id: string
  title: string
  address: string
  phone: string
  rating: number
  website: string
  category: string
  map_link: string
  created_at: string
}

export default function AutoBusinessFinderPage() {
  const [scraperStatus, setScraperStatus] = useState<ScraperStatus>({
    status: 'idle',
    message: 'Ready to start scraping. Click the button below to begin.',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null)

  /**
   * Fetch live businesses from Supabase
   * Updates in real-time as scraper adds new leads
   */
  const fetchLiveBusinesses = async () => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      if (!supabaseUrl || !supabaseKey) {
        console.error('Supabase credentials not configured')
        return
      }

      const supabase = createClient(supabaseUrl, supabaseKey)
      const { data, error } = await supabase
        .from('Roofing Leads New')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
        console.error('Error fetching businesses:', error)
        return
      }

      setBusinesses(data || [])
    } catch (error) {
      console.error('Error in fetchLiveBusinesses:', error)
    }
  }

  /**
   * Triggers the Google Maps scraper via GitHub Actions
   * This will:
   * 1. Fetch all unused searches from Supabase
   * 2. Use headless browser to scrape Google Maps for each search
   * 3. Extract business data (title, address, phone, rating, etc.)
   * 4. Store results in "Roofing Leads New" table
   * 5. Mark searches as used in "Google_Maps Searches" table
   */
  const handleStartScraper = async () => {
    setIsLoading(true)
    setScraperStatus({
      status: 'running',
      message: 'Initializing scraper... This may take several minutes.',
      progress: { completed: 0, total: 1000 },
    })

    try {
      // Call API endpoint to trigger scraper
      const response = await fetch('/api/trigger-scraper', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'start_scraper',
          timestamp: new Date().toISOString(),
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      setWorkflowId(data.workflowId)

      setScraperStatus({
        status: 'running',
        message: `Scraper started successfully. Workflow ID: ${data.workflowId}. Monitoring progress...`,
        progress: { completed: 0, total: 1000 },
        timestamp: new Date().toLocaleTimeString(),
      })

      // Fetch initial businesses
      await fetchLiveBusinesses()

      // Poll for status updates every 10 seconds (more frequent for real-time feel)
      const interval = setInterval(async () => {
        try {
          // Fetch updated status
          const statusResponse = await fetch(
            `/api/scraper-status?workflowId=${data.workflowId}`
          )
          const statusData = await statusResponse.json()

          // Fetch live businesses count
          await fetchLiveBusinesses()

          if (statusData.status === 'completed') {
            clearInterval(interval)
            setScraperStatus({
              status: 'completed',
              message: `Scraping completed! ${statusData.businessesFound} businesses found and stored in database.`,
              progress: {
                completed: statusData.businessesFound,
                total: 1000,
              },
              timestamp: new Date().toLocaleTimeString(),
            })
            setIsLoading(false)
          } else if (statusData.status === 'failed') {
            clearInterval(interval)
            setScraperStatus({
              status: 'error',
              message: `Scraper failed: ${statusData.error}`,
              timestamp: new Date().toLocaleTimeString(),
            })
            setIsLoading(false)
          } else {
            // Update progress with live count
            setScraperStatus({
              status: 'running',
              message: `Scraper running... ${statusData.businessesFound} businesses found so far.`,
              progress: {
                completed: statusData.businessesFound,
                total: 1000,
              },
              timestamp: new Date().toLocaleTimeString(),
            })
          }
        } catch (error) {
          // Continue polling even if status check fails
          console.log('Status check in progress...')
        }
      }, 10000)

      setPollInterval(interval)
    } catch (error) {
      setScraperStatus({
        status: 'error',
        message: `Error starting scraper: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toLocaleTimeString(),
      })
      setIsLoading(false)
    }
  }

  /**
   * Manually refresh the live businesses list
   */
  const handleRefreshBusinesses = async () => {
    await fetchLiveBusinesses()
  }

  /**
   * Get status badge color based on current status
   */
  const getStatusColor = () => {
    switch (scraperStatus.status) {
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

  /**
   * Get status icon based on current status
   */
  const getStatusIcon = () => {
    switch (scraperStatus.status) {
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

  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />

      <main className="lg:ml-64 p-4 lg:p-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Auto Business Finder
          </h1>
          <p className="text-slate-400">
            Scrape Google Maps for all generated searches and automatically
            store business data with real-time progress tracking
          </p>
        </div>

        {/* Status Card */}
        <Card className={`border ${getStatusColor()} p-6 mb-6`}>
          <div className="flex items-start gap-4">
            <div className="mt-1">{getStatusIcon()}</div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-1">
                Scraper Status
              </h3>
              <p className="text-slate-300 mb-2">{scraperStatus.message}</p>

              {/* Progress Bar */}
              {scraperStatus.progress && (
                <div className="mt-4">
                  <div className="flex justify-between text-sm text-slate-400 mb-2">
                    <span>Progress</span>
                    <span>
                      {scraperStatus.progress.completed} /{' '}
                      {scraperStatus.progress.total}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(scraperStatus.progress.completed / scraperStatus.progress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {scraperStatus.timestamp && (
                <p className="text-xs text-slate-500 mt-3">
                  Last updated: {scraperStatus.timestamp}
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Main Control Card */}
        <Card className="bg-slate-900 border-slate-800 p-8 mb-6">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white mb-2">
              Start Google Maps Scraper
            </h2>
            <p className="text-slate-400">
              This will scrape all 1000+ generated Google Maps searches using a
              headless browser in GitHub Actions. Business data will be
              automatically stored in your Supabase database and displayed below
              in real-time.
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-semibold text-white mb-3">
              What happens when you click start:
            </h3>
            <ul className="space-y-2 text-sm text-slate-300">
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>
                  GitHub Actions workflow triggers with headless Playwright
                  browser
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>
                  Fetches all unused searches from &quot;Google_Maps Searches&quot; table
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>
                  Inputs each search into Google Maps and scrapes business
                  results
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>
                  Extracts: Title, Address, Phone, Rating, Website, Category,
                  Working Hours, Map Link, Cover Image
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>
                  Stores all data in &quot;Roofing Leads New&quot; table with unique
                  constraint on normalized title
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>
                  Results appear below in real-time as they&apos;re being scraped
                </span>
              </li>
            </ul>
          </div>

          <Button
            onClick={handleStartScraper}
            disabled={isLoading || scraperStatus.status === 'running'}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {isLoading || scraperStatus.status === 'running'
              ? 'Scraper Running...'
              : 'Start Google Maps Scraper'}
          </Button>
        </Card>

        {/* Live Results Section */}
        <Card className="bg-slate-900 border-slate-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">
              Live Results ({businesses.length})
            </h2>
            <Button
              onClick={handleRefreshBusinesses}
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
                here in real-time.
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
                  {businesses.map((business) => (
                    <tr
                      key={business.id}
                      className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-3 px-4 text-slate-200">
                        {business.title}
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-xs">
                        {business.address}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {business.phone || '-'}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {business.rating ? `${business.rating}★` : '-'}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {business.category || '-'}
                      </td>
                      <td className="py-3 px-4">
                        {business.website ? (
                          <a
                            href={business.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 truncate"
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

        {/* Information Cards */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="bg-slate-900 border-slate-800 p-6">
            <h3 className="text-lg font-semibold text-white mb-3">
              Database Tables
            </h3>
            <div className="space-y-3 text-sm text-slate-300">
              <div>
                <p className="font-medium text-white mb-1">
                  Google_Maps Searches
                </p>
                <p className="text-slate-400">
                  Source table with 1000+ search queries. Marked as used after
                  scraping.
                </p>
              </div>
              <div>
                <p className="font-medium text-white mb-1">
                  Roofing Leads New
                </p>
                <p className="text-slate-400">
                  Destination table storing all scraped business data with
                  deduplication.
                </p>
              </div>
            </div>
          </Card>

          <Card className="bg-slate-900 border-slate-800 p-6">
            <h3 className="text-lg font-semibold text-white mb-3">
              Extracted Data Fields
            </h3>
            <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
              <div>✓ Title</div>
              <div>✓ Address</div>
              <div>✓ Phone Number</div>
              <div>✓ Rating</div>
              <div>✓ Website</div>
              <div>✓ Category</div>
              <div>✓ Working Hours</div>
              <div>✓ Map Link</div>
              <div>✓ Cover Image</div>
              <div>✓ Row Number</div>
            </div>
          </Card>
        </div>

        {/* GitHub Actions Info */}
        <Card className="bg-slate-900 border-slate-800 p-6 mt-6">
          <h3 className="text-lg font-semibold text-white mb-3">
            GitHub Actions Integration
          </h3>
          <p className="text-slate-400 mb-4">
            The scraper runs as a GitHub Actions workflow for reliable,
            scalable execution. Monitor progress in your GitHub repository:
          </p>
          <a
            href="https://github.com/rileywebboost-afk/UltimateLeadGen/actions"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
          >
            View GitHub Actions Workflows →
          </a>
        </Card>
      </main>
    </div>
  )
}
