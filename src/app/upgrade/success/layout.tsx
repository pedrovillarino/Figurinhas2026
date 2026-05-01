// Force dynamic rendering — the success page reads user state via the
// Supabase browser client, which throws at build time if NEXT_PUBLIC_*
// env vars aren't set (branch previews don't have them, only main does).
export const dynamic = 'force-dynamic'

export default function UpgradeSuccessLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
