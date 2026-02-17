/**
 * Google Maps Searches Generator Page
 * Main feature for generating unique Google Maps search queries
 */

'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Sidebar } from '@/components/layout/Sidebar'
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Download,
  Loader2,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface SearchResult {
  search: string
  status: 'new' | 'exists' | 'invalid'
  editable: boolean
}

export default function GoogleMapsGeneratorPage() {
  // Input state
  const [niche, setNiche] = useState('')
  const [maxSearches, setMaxSearches] = useState(1000)
  const [includeCities, setIncludeCities] = useState(true)
  const [includeCounties, setIncludeCounties] = useState(false)

  // Results state
  const [searches, setSearches] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50

  // Insertion state
  const [inserting, setInserting] = useState(false)
  const [insertError, setInsertError] = useState('')
  const [insertSuccess, setInsertSuccess] = useState('')

  /**
   * Generate searches based on user input
   * Calls the /api/generate-searches endpoint
   */
  const handleGenerate = async () => {
    // Validate input
    if (!niche.trim()) {
      setError('Please enter a niche')
      return
    }

    if (maxSearches < 100 || maxSearches > 5000) {
      setError('Max searches must be between 100 and 5000')
      return
    }

    if (!includeCities && !includeCounties) {
      setError('Please select at least one location type')
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')

    try {
      // Call API to generate searches
      const response = await fetch('/api/generate-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          niche: niche.trim(),
          maxSearches,
          includeCities,
          includeCounties,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to generate searches')
      }

      const data = await response.json()

      // Convert generated searches to SearchResult objects
      const results: SearchResult[] = data.data.searches.map(
        (search: string) => ({
          search,
          status: 'new' as const,
          editable: true,
        })
      )

      setSearches(results)
      setCurrentPage(1)
      setSuccess(
        `Generated ${results.length} unique searches (${data.data.deduplicatedCount} after deduplication)`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Insert searches into Supabase database
   * Checks for duplicates and inserts only new searches
   */
  const handleInsert = async () => {
    if (searches.length === 0) {
      setInsertError('No searches to insert')
      return
    }

    setInserting(true)
    setInsertError('')
    setInsertSuccess('')

    try {
      // Extract search strings
      const searchStrings = searches.map((s) => s.search)

      // Call API to insert searches
      const response = await fetch('/api/insert-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searches: searchStrings }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to insert searches')
      }

      const data = await response.json()

      // Update search statuses based on insertion result
      // Keep original searches without modifying status
      setSearches(searches)
      setInsertSuccess(
        `Successfully inserted ${data.data.inserted} new searches. ${data.data.alreadyExisted} already existed.`
      )
    } catch (err) {
      setInsertError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setInserting(false)
    }
  }

  /**
   * Clear all generated searches
   */
  const handleClear = () => {
    setSearches([])
    setNiche('')
    setError('')
    setSuccess('')
    setInsertError('')
    setInsertSuccess('')
    setCurrentPage(1)
  }

  /**
   * Export searches as CSV
   */
  const handleExport = () => {
    if (searches.length === 0) return

    const csv = searches.map((s) => s.search).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `searches-${Date.now()}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  /**
   * Copy all searches to clipboard
   */
  const handleCopyAll = async () => {
    if (searches.length === 0) return

    const text = searches.map((s) => s.search).join('\n')
    await navigator.clipboard.writeText(text)
    setSuccess('Copied all searches to clipboard!')
  }

  // Calculate pagination
  const totalPages = Math.ceil(searches.length / itemsPerPage)
  const startIdx = (currentPage - 1) * itemsPerPage
  const endIdx = startIdx + itemsPerPage
  const paginatedSearches = searches.slice(startIdx, endIdx)

  // Count statuses
  const newCount = searches.filter((s) => s.status === 'new').length
  const existsCount = searches.filter((s) => s.status === 'exists').length
  const invalidCount = searches.filter((s) => s.status === 'invalid').length

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content */}
      <main className="lg:ml-64 p-4 lg:p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Google Maps Searches Generator
          </h1>
          <p className="text-slate-400">
            Generate unique Google Maps search queries for your niche across UK
            locations
          </p>
        </div>

        {/* Input Panel */}
        <Card className="bg-slate-900 border-slate-800 p-6 mb-8">
          <h2 className="text-xl font-semibold text-white mb-6">
            Generate Searches
          </h2>

          <div className="space-y-6">
            {/* Niche Input */}
            <div>
              <Label htmlFor="niche" className="text-white mb-2 block">
                Niche / Business Type
              </Label>
              <Input
                id="niche"
                placeholder="e.g., roofers, dentists, plumbers, accountants"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder-slate-500"
              />
              <p className="text-xs text-slate-400 mt-2">
                Enter the business type or service you want to generate searches
                for
              </p>
            </div>

            {/* Max Searches Input */}
            <div>
              <Label htmlFor="maxSearches" className="text-white mb-2 block">
                Maximum Searches (100-5000)
              </Label>
              <Input
                id="maxSearches"
                type="number"
                min="100"
                max="5000"
                step="100"
                value={maxSearches}
                onChange={(e) => setMaxSearches(parseInt(e.target.value))}
                className="bg-slate-800 border-slate-700 text-white"
              />
              <p className="text-xs text-slate-400 mt-2">
                Default: 1000 searches. Higher numbers = more comprehensive
                coverage
              </p>
            </div>

            {/* Location Type Toggles */}
            <div>
              <Label className="text-white mb-4 block">Location Types</Label>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="cities"
                    checked={includeCities}
                    onCheckedChange={(checked) =>
                      setIncludeCities(checked as boolean)
                    }
                    className="border-slate-600"
                  />
                  <Label
                    htmlFor="cities"
                    className="text-slate-300 cursor-pointer"
                  >
                    Include UK Cities (150+ major cities)
                  </Label>
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="counties"
                    checked={includeCounties}
                    onCheckedChange={(checked) =>
                      setIncludeCounties(checked as boolean)
                    }
                    className="border-slate-600"
                  />
                  <Label
                    htmlFor="counties"
                    className="text-slate-300 cursor-pointer"
                  >
                    Include UK Counties (50+ counties)
                  </Label>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Select at least one location type. Cities provide more targeted
                searches.
              </p>
            </div>

            {/* Error Alert */}
            {error && (
              <Alert className="bg-red-950 border-red-800">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <AlertDescription className="text-red-200">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            {/* Success Alert */}
            {success && (
              <Alert className="bg-green-950 border-green-800">
                <CheckCircle className="h-4 w-4 text-green-400" />
                <AlertDescription className="text-green-200">
                  {success}
                </AlertDescription>
              </Alert>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleGenerate}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 flex items-center gap-2"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {loading ? 'Generating...' : 'Generate Searches'}
              </Button>
              {searches.length > 0 && (
                <Button
                  onClick={handleClear}
                  variant="outline"
                  className="border-slate-600 text-slate-300 hover:bg-slate-800"
                >
                  <Trash2 size={16} />
                  Clear
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Results Panel */}
        {searches.length > 0 && (
          <>
            {/* Stats */}
            <Card className="bg-slate-900 border-slate-800 p-6 mb-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-slate-400 text-sm">Total Generated</p>
                  <p className="text-2xl font-bold text-white">
                    {searches.length}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">New</p>
                  <p className="text-2xl font-bold text-green-400">
                    {newCount}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Already Exists</p>
                  <p className="text-2xl font-bold text-yellow-400">
                    {existsCount}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Invalid</p>
                  <p className="text-2xl font-bold text-red-400">
                    {invalidCount}
                  </p>
                </div>
              </div>
            </Card>

            {/* Insert Error Alert */}
            {insertError && (
              <Alert className="bg-red-950 border-red-800 mb-8">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <AlertDescription className="text-red-200">
                  {insertError}
                </AlertDescription>
              </Alert>
            )}

            {/* Insert Success Alert */}
            {insertSuccess && (
              <Alert className="bg-green-950 border-green-800 mb-8">
                <CheckCircle className="h-4 w-4 text-green-400" />
                <AlertDescription className="text-green-200">
                  {insertSuccess}
                </AlertDescription>
              </Alert>
            )}

            {/* Results Table */}
            <Card className="bg-slate-900 border-slate-800 p-6 mb-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-white">
                  Generated Searches
                </h2>
                <div className="flex gap-2">
                  <Button
                    onClick={handleCopyAll}
                    variant="outline"
                    size="sm"
                    className="border-slate-600 text-slate-300 hover:bg-slate-800"
                  >
                    <Copy size={16} />
                    Copy All
                  </Button>
                  <Button
                    onClick={handleExport}
                    variant="outline"
                    size="sm"
                    className="border-slate-600 text-slate-300 hover:bg-slate-800"
                  >
                    <Download size={16} />
                    Export CSV
                  </Button>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-3 px-4 text-slate-400 font-medium">
                        Search Query
                      </th>
                      <th className="text-left py-3 px-4 text-slate-400 font-medium w-24">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedSearches.map((result, idx) => (
                      <tr
                        key={startIdx + idx}
                        className="border-b border-slate-800 hover:bg-slate-800/50"
                      >
                        <td className="py-3 px-4 text-slate-200">
                          {result.search}
                        </td>
                        <td className="py-3 px-4">
                          {result.status === 'new' && (
                            <span className="inline-flex items-center gap-1 bg-green-900/30 text-green-400 px-2 py-1 rounded text-xs font-medium">
                              <CheckCircle size={14} />
                              New
                            </span>
                          )}
                          {result.status === 'exists' && (
                            <span className="inline-flex items-center gap-1 bg-yellow-900/30 text-yellow-400 px-2 py-1 rounded text-xs font-medium">
                              <AlertTriangle size={14} />
                              Exists
                            </span>
                          )}
                          {result.status === 'invalid' && (
                            <span className="inline-flex items-center gap-1 bg-red-900/30 text-red-400 px-2 py-1 rounded text-xs font-medium">
                              <AlertCircle size={14} />
                              Invalid
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-6 pt-6 border-t border-slate-700">
                  <p className="text-sm text-slate-400">
                    Page {currentPage} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() =>
                        setCurrentPage(Math.max(1, currentPage - 1))
                      }
                      disabled={currentPage === 1}
                      variant="outline"
                      size="sm"
                      className="border-slate-600 text-slate-300 hover:bg-slate-800"
                    >
                      Previous
                    </Button>
                    <Button
                      onClick={() =>
                        setCurrentPage(Math.min(totalPages, currentPage + 1))
                      }
                      disabled={currentPage === totalPages}
                      variant="outline"
                      size="sm"
                      className="border-slate-600 text-slate-300 hover:bg-slate-800"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Insert Button */}
            <Card className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-blue-600/50 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">
                    Ready to Save?
                  </h3>
                  <p className="text-slate-300 text-sm">
                    Insert these searches into the database for later use
                  </p>
                </div>
                <Button
                  onClick={handleInsert}
                  disabled={inserting || searches.length === 0}
                  className="bg-blue-600 hover:bg-blue-700 flex items-center gap-2"
                >
                  {inserting && <Loader2 size={16} className="animate-spin" />}
                  {inserting ? 'Inserting...' : 'Insert into Database'}
                </Button>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}
