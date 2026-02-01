/**
 * Auto Lead Researcher Page
 * Placeholder for future lead enrichment feature
 */

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sidebar } from '@/components/layout/Sidebar'
import { Users, Zap, Lock } from 'lucide-react'

export default function AutoLeadResearcherPage() {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />

      <main className="lg:ml-64 p-4 lg:p-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Auto Lead Researcher
          </h1>
          <p className="text-slate-400">
            Automatically enrich business data and discover contact information
          </p>
        </div>

        <Card className="bg-slate-900 border-slate-800 p-12 text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-slate-800 p-6 rounded-lg">
              <Users size={48} className="text-slate-500" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Coming Soon</h2>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            This feature is currently in development. It will automatically
            enrich business data, discover contact information, and gather
            social links for your leads.
          </p>

          <div className="grid md:grid-cols-3 gap-4 mt-8 max-w-2xl mx-auto">
            <div className="bg-slate-800/50 p-4 rounded-lg">
              <Zap className="text-blue-400 mx-auto mb-2" size={24} />
              <p className="text-sm text-slate-300">Business Enrichment</p>
            </div>
            <div className="bg-slate-800/50 p-4 rounded-lg">
              <Users className="text-blue-400 mx-auto mb-2" size={24} />
              <p className="text-sm text-slate-300">Contact Discovery</p>
            </div>
            <div className="bg-slate-800/50 p-4 rounded-lg">
              <Lock className="text-blue-400 mx-auto mb-2" size={24} />
              <p className="text-sm text-slate-300">Social Links</p>
            </div>
          </div>

          <Button disabled className="mt-8 bg-slate-700 cursor-not-allowed">
            Feature Locked
          </Button>
        </Card>
      </main>
    </div>
  )
}
