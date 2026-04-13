import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-white">
      <div className="text-6xl font-black text-brand mb-4">404</div>
      <h1 className="text-2xl font-bold text-navy mb-2">Figurinha não encontrada</h1>
      <p className="text-gray-500 mb-6 max-w-sm">
        Essa página pode ter sido trocada, colada ou simplesmente não existe.
      </p>
      <Link
        href="/"
        className="bg-brand text-white font-semibold px-6 py-3 rounded-full hover:bg-brand-dark transition active:scale-[0.98]"
      >
        Voltar para a home
      </Link>
    </main>
  )
}
