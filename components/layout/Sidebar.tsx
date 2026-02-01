/**
 * Sidebar Navigation Component
 * Main navigation for the application
 * Displays links to all major sections
 */

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  BarChart3,
  MapPin,
  Users,
  Mail,
  Globe,
  Menu,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

// Navigation items configuration
const navItems = [
  {
    label: 'Dashboard',
    href: '/',
    icon: BarChart3,
  },
  {
    label: 'Google Maps Generator',
    href: '/google-maps-generator',
    icon: MapPin,
  },
  {
    label: 'Auto Business Finder',
    href: '/auto-business-finder',
    icon: Users,
  },
  {
    label: 'Auto Outreach System',
    href: '/auto-outreach',
    icon: Mail,
  },
  {
    label: 'Email Responses',
    href: '/email-responses',
    icon: Mail,
  },
  {
    label: 'Auto Website Creator',
    href: '/auto-website-creator',
    icon: Globe,
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Mobile menu button */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(!isOpen)}
          className="text-white"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen w-64 bg-slate-900 border-r border-slate-800 transition-transform duration-300 z-40',
          'lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo/Brand */}
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold text-white">Lead Gen</h1>
          <p className="text-xs text-slate-400 mt-1">UK Lead Generation</p>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                )}
              >
                <Icon size={20} />
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800">
          <p className="text-xs text-slate-500">v1.0.0</p>
        </div>
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
