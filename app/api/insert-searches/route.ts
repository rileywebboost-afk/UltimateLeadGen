/**
 * API Route: Insert Searches into Supabase
 * POST /api/insert-searches
 * 
 * Inserts generated searches into the database
 * Handles duplicates gracefully
 */

import { checkExistingSearches, insertSearches } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json()
    const { searches } = body

    // Validate input
    if (!Array.isArray(searches) || searches.length === 0) {
      return NextResponse.json(
        { error: 'Searches must be a non-empty array' },
        { status: 400 }
      )
    }

    // Step 1: Check which searches already exist in the database
    const existingSearches = await checkExistingSearches(searches)
    const newSearches = searches.filter((s: string) => !existingSearches.has(s))

    // Step 2: Insert new searches
    const insertResult = await insertSearches(newSearches)

    // Return summary
    return NextResponse.json({
      success: true,
      data: {
        totalRequested: searches.length,
        alreadyExisted: existingSearches.size,
        newSearches: newSearches.length,
        inserted: insertResult.inserted,
        skipped: insertResult.skipped,
        errors: insertResult.errors,
      },
    })
  } catch (error) {
    console.error('Error inserting searches:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
