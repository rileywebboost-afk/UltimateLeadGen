/**
 * API Route: Get Leads Count
 * 
 * Fetches the total number of leads in the "Roofing Leads New" table
 * Used for real-time progress tracking
 * 
 * GET /api/leads-count
 * Response: { count: number }
 */

import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const { count, error } = await supabase
      .from('Roofing Leads New')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('Error fetching leads count:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ count: count || 0 })
  } catch (error) {
    console.error('Error in leads-count API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
