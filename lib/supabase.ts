/**
 * Supabase Client Module
 * Handles database operations and authentication
 */

import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client with service role key for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Check which searches already exist in the database
 * Batches requests in chunks of 100 to respect Supabase limits
 * @param searches - Array of search strings to check
 * @returns Set of existing search strings
 */
export async function checkExistingSearches(searches: string[]): Promise<Set<string>> {
  const existing = new Set<string>()

  // Batch in chunks of 100 (Supabase limit)
  for (let i = 0; i < searches.length; i += 100) {
    const chunk = searches.slice(i, i + 100)
    const { data, error } = await supabase
      .from('Google_Maps Searches')
      .select('Searches')
      .in('Searches', chunk)

    if (error) {
      console.error('Error checking existing searches:', error)
      throw error
    }

    // Add all existing searches to the set
    data?.forEach((row: { Searches: string }) => existing.add(row.Searches))
  }

  return existing
}

/**
 * Insert new searches into Supabase
 * Uses upsert to handle duplicates gracefully
 * @param searches - Array of search strings to insert
 * @returns Object with insert statistics
 */
export async function insertSearches(searches: string[]): Promise<{
  inserted: number
  skipped: number
  errors: string[]
}> {
  if (searches.length === 0) {
    return { inserted: 0, skipped: 0, errors: [] }
  }

  // Prepare rows for insertion
  const rows = searches.map((search) => ({
    Searches: search,
    searchUSED: false,
  }))

  // Use upsert to handle conflicts (duplicate searches)
  const { error, data } = await supabase
    .from('Google_Maps Searches')
    .upsert(rows, { onConflict: 'Searches' })
    .select()

  if (error) {
    console.error('Error inserting searches:', error)
    return {
      inserted: 0,
      skipped: searches.length,
      errors: [error.message],
    }
  }

  return {
    inserted: data?.length || searches.length,
    skipped: 0,
    errors: [],
  }
}

/**
 * Get total count of searches in database
 * @returns Total number of searches
 */
export async function getTotalSearchesCount(): Promise<number> {
  const { count, error } = await supabase
    .from('Google_Maps Searches')
    .select('*', { count: 'exact', head: true })

  if (error) {
    console.error('Error getting search count:', error)
    return 0
  }

  return count || 0
}

/**
 * Get count of unused searches (searchUSED = false)
 * @returns Number of unused searches
 */
export async function getUnusedSearchesCount(): Promise<number> {
  const { count, error } = await supabase
    .from('Google_Maps Searches')
    .select('*', { count: 'exact', head: true })
    .eq('searchUSED', false)

  if (error) {
    console.error('Error getting unused search count:', error)
    return 0
  }

  return count || 0
}
