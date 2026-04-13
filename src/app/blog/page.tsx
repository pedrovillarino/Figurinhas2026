import Link from 'next/link'
import type { Metadata } from 'next'
import { getAllBlogPosts } from '@/lib/blog'

export const metadata: Metadata = {
  title: 'Blog — Complete Aí',
  description: 'Dicas, novidades e guias sobre como completar seu álbum de figurinhas com IA.',
  openGraph: {
    title: 'Blog — Complete Aí',
    url: 'https://www.completeai.com.br/blog',
  },
  alternates: { canonical: 'https://www.completeai.com.br/blog' },
}

export default function BlogIndex() {
  const posts = getAllBlogPosts()

  return (
    <main className="min-h-screen bg-white">
      <header className="bg-gradient-to-b from-[#0A1628] to-[#1A2332] text-white px-6 py-10 text-center">
        <Link href="/" className="inline-block mb-4 text-sm text-white/60 hover:text-white/90 transition">
          &larr; Voltar
        </Link>
        <h1 className="text-3xl font-black mb-2">Blog</h1>
        <p className="text-white/70 text-sm max-w-md mx-auto">
          Dicas, novidades e guias para completar seu álbum
        </p>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8">
        {posts.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📝</div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">Em breve!</h2>
            <p className="text-sm text-gray-500">
              Estamos preparando conteúdo incrível sobre figurinhas, IA e trocas.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md transition group"
              >
                {post.image && (
                  <div className="h-40 bg-gray-100 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={post.image}
                      alt={post.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <time className="text-[11px] text-gray-400">
                      {new Date(post.date).toLocaleDateString('pt-BR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </time>
                    {post.tags?.slice(0, 2).map((tag) => (
                      <span key={tag} className="text-[10px] bg-brand-light text-brand-dark rounded-full px-2 py-0.5 font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h2 className="text-base font-bold text-gray-900 mb-1 group-hover:text-brand transition">
                    {post.title}
                  </h2>
                  <p className="text-sm text-gray-500 line-clamp-2">
                    {post.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
