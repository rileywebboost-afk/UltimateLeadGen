/**
 * Auto Business Finder Page
 * Scrapes Google Maps for all generated searches and stores business data
 * Integrates with GitHub Actions for headless browser automation
 */

'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/layout/Sidebar'
import { AlertCircle, CheckCircle, Clock, Zap } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ScraperStatus {
  status: 'idle' | 'running' | 'completed' | 'error'
  message: string
  progress?: {
    completed: number
    total: number
  }
  timestamp?: string
}

export default function AutoBusinessFinderPage() {
  const [scraperStatus, setScraperStatus] = useState<ScraperStatus>({
    status: 'idle',
    message: 'Ready to start scraping. Click the button below to begin.',
  })
  const [isLoading, setIsLoading] = useState(false)

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

      setScraperStatus({
        status: 'running',
        message: `Scraper started successfully. Workflow ID: ${data.workflowId}. Check GitHub Actions for real-time progress.`,
        progress: { completed: 0, total: 1000 },
        timestamp: new Date().toLocaleTimeString(),
      })

      // Poll for status updates every 30 seconds
      const pollInterval = setInterval(async () => {
        try {
          const statusResponse = await fetch(
            `/api/scraper-status?workflowId=${data.workflowId}`
          )
          const statusData = await statusResponse.json()

          if (statusData.status === 'completed') {
            clearInterval(pollInterval)
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
            clearInterval(pollInterval)
            setScraperStatus({
              status: 'error',
              message: `Scraper failed: ${statusData.error}`,
              timestamp: new Date().toLocaleTimeString(),
            })
            setIsLoading(false)
          }
        } catch (error) {
          // Continue polling even if status check fails
          console.log('Status check in progress...')
        }
      }, 30000)
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
            store business data
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
              automatically stored in your Supabase database.
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
                  Fetches all unused searches from "Google_Maps Searches" table
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
                  Stores all data in "Roofing Leads New" table with unique
                  constraint on normalized title
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-1">•</span>
                <span>
                  Marks searches as used (searchUSED = true) to avoid
                  duplicates
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
            href="https://github.com/Halfpro6119/UltimateLeadGen/actions"
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
