/**
 * API Route: Generate Google Maps Searches
 * POST /api/generate-searches
 * 
 * Generates unique Google Maps search queries for a given niche
 */

import { generateSearches } from '@/lib/generateSearches'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json()
    const {
      niche,
      maxSearches = 1000,
      includeCities = true,
      includeCounties = false,
    } = body

    // Validate input
    if (!niche || typeof niche !== 'string') {
      return NextResponse.json(
        { error: 'Niche is required and must be a string' },
        { status: 400 }
      )
    }

    if (typeof maxSearches !== 'number' || maxSearches < 100 || maxSearches > 5000) {
      return NextResponse.json(
        { error: 'Max searches must be between 100 and 5000' },
        { status: 400 }
      )
    }

    // Generate searches
    const searches = generateSearches(
      niche,
      maxSearches,
      includeCities,
      includeCounties
    )

    // Calculate statistics
    const totalGenerated = searches.length
    const deduplicatedCount = new Set(searches).size

    return NextResponse.json({
      success: true,
      data: {
        searches,
        totalGenerated,
        deduplicatedCount,
        validCount: searches.length,
      },
    })
  } catch (error) {
    console.error('Error generating searches:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      { error: errorMessage },
      { status: 400 }
    )
  }
}
