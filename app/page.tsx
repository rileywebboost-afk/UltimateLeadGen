/**
 * Dashboard Page
 * Main landing page showing app overview and quick stats
 */

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Sidebar } from '@/components/layout/Sidebar'
import { MapPin, Users, Mail, Globe, TrendingUp, Zap } from 'lucide-react'

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-slate-950">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content */}
      <main className="lg:ml-64 p-4 lg:p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Ultimate Lead Gen App
          </h1>
          <p className="text-slate-400">
            UK-focused lead generation tool with automated search generation
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Stat Card 1 */}
          <Card className="bg-slate-900 border-slate-800 p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">
                  Total Searches Generated
                </p>
                <p className="text-3xl font-bold text-white mt-2">0</p>
                <p className="text-xs text-slate-500 mt-1">This month</p>
              </div>
              <div className="bg-blue-600/20 p-3 rounded-lg">
                <TrendingUp className="text-blue-400" size={24} />
              </div>
            </div>
          </Card>

          {/* Stat Card 2 */}
          <Card className="bg-slate-900 border-slate-800 p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">
                  Searches in Database
                </p>
                <p className="text-3xl font-bold text-white mt-2">0</p>
                <p className="text-xs text-slate-500 mt-1">Ready to use</p>
              </div>
              <div className="bg-green-600/20 p-3 rounded-lg">
                <MapPin className="text-green-400" size={24} />
              </div>
            </div>
          </Card>

          {/* Stat Card 3 */}
          <Card className="bg-slate-900 border-slate-800 p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">
                  Active Features
                </p>
                <p className="text-3xl font-bold text-white mt-2">1</p>
                <p className="text-xs text-slate-500 mt-1">Of 6 total</p>
              </div>
              <div className="bg-purple-600/20 p-3 rounded-lg">
                <Zap className="text-purple-400" size={24} />
              </div>
            </div>
          </Card>
        </div>

        {/* Features Overview */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-6">Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Feature 1: Google Maps Generator */}
            <Card className="bg-slate-900 border-slate-800 p-6 hover:border-blue-600 transition-colors">
              <div className="flex items-start gap-4">
                <div className="bg-blue-600/20 p-3 rounded-lg">
                  <MapPin className="text-blue-400" size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Google Maps Searches Generator
                  </h3>
                  <p className="text-slate-400 text-sm mb-4">
                    Generate unique Google Maps search queries for any niche
                    across UK cities and counties. Automatically deduplicate
                    and insert into database.
                  </p>
                  <Link href="/google-maps-generator">
                    <Button className="bg-blue-600 hover:bg-blue-700">
                      Open Generator
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>

            {/* Feature 2: Auto Lead Researcher */}
            <Card className="bg-slate-900 border-slate-800 p-6 opacity-60">
              <div className="flex items-start gap-4">
                <div className="bg-slate-700/50 p-3 rounded-lg">
                  <Users className="text-slate-500" size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Auto Lead Researcher
                  </h3>
                  <p className="text-slate-400 text-sm mb-4">
                    Automatically enrich business data, discover contact
                    information, and gather social links.
                  </p>
                  <div className="inline-block bg-slate-800 text-slate-400 px-3 py-1 rounded text-xs font-medium">
                    Coming Soon
                  </div>
                </div>
              </div>
            </Card>

            {/* Feature 3: Auto Outreach System */}
            <Card className="bg-slate-900 border-slate-800 p-6 opacity-60">
              <div className="flex items-start gap-4">
                <div className="bg-slate-700/50 p-3 rounded-lg">
                  <Mail className="text-slate-500" size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Auto Outreach System
                  </h3>
                  <p className="text-slate-400 text-sm mb-4">
                    Create email sequences, manage templates, and integrate
                    with email providers.
                  </p>
                  <div className="inline-block bg-slate-800 text-slate-400 px-3 py-1 rounded text-xs font-medium">
                    Coming Soon
                  </div>
                </div>
              </div>
            </Card>

            {/* Feature 4: Email Responses */}
            <Card className="bg-slate-900 border-slate-800 p-6 opacity-60">
              <div className="flex items-start gap-4">
                <div className="bg-slate-700/50 p-3 rounded-lg">
                  <Mail className="text-slate-500" size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Email Responses
                  </h3>
                  <p className="text-slate-400 text-sm mb-4">
                    Classify responses, draft AI-powered replies, and schedule
                    follow-ups automatically.
                  </p>
                  <div className="inline-block bg-slate-800 text-slate-400 px-3 py-1 rounded text-xs font-medium">
                    Coming Soon
                  </div>
                </div>
              </div>
            </Card>

            {/* Feature 5: Auto Website Creator */}
            <Card className="bg-slate-900 border-slate-800 p-6 opacity-60 md:col-span-2">
              <div className="flex items-start gap-4">
                <div className="bg-slate-700/50 p-3 rounded-lg">
                  <Globe className="text-slate-500" size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Auto Website Creator
                  </h3>
                  <p className="text-slate-400 text-sm mb-4">
                    Generate landing pages from templates, deploy instantly,
                    and track analytics.
                  </p>
                  <div className="inline-block bg-slate-800 text-slate-400 px-3 py-1 rounded text-xs font-medium">
                    Coming Soon
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Quick Start */}
        <Card className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-blue-600/50 p-8">
          <h3 className="text-xl font-bold text-white mb-2">Quick Start</h3>
          <p className="text-slate-300 mb-4">
            Get started by generating Google Maps searches for your niche.
          </p>
          <Link href="/google-maps-generator">
            <Button className="bg-blue-600 hover:bg-blue-700">
              Generate Searches Now
            </Button>
          </Link>
        </Card>
      </main>
    </div>
  )
}
