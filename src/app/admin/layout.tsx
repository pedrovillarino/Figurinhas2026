import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Complete Aí — Admin',
  robots: 'noindex, nofollow',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50">{children}</div>
}
