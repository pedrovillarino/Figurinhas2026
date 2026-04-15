import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Perfil',
  description: 'Gerencie seu perfil e configurações do álbum de figurinhas.',
}

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
