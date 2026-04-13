import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getBlogPost, getBlogSlugs } from '@/lib/blog'
import { MDXRemote } from 'next-mdx-remote/rsc'

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return getBlogSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = getBlogPost(slug)
  if (!post) return {}

  return {
    title: `${post.title} — Complete Aí`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      url: `https://www.completeai.com.br/blog/${slug}`,
      type: 'article',
      publishedTime: post.date,
      images: post.image ? [{ url: post.image }] : undefined,
    },
    alternates: { canonical: `https://www.completeai.com.br/blog/${slug}` },
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = getBlogPost(slug)
  if (!post) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { '@type': 'Person', name: post.author },
    publisher: { '@type': 'Organization', name: 'Complete Aí' },
    url: `https://www.completeai.com.br/blog/${slug}`,
    image: post.image || undefined,
  }

  return (
    <main className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="bg-gradient-to-b from-[#0A1628] to-[#1A2332] text-white px-6 py-10">
        <div className="max-w-2xl mx-auto">
          <Link href="/blog" className="inline-block mb-4 text-sm text-white/60 hover:text-white/90 transition">
            &larr; Blog
          </Link>
          <h1 className="text-2xl font-black mb-3">{post.title}</h1>
          <div className="flex items-center gap-3 text-sm text-white/60">
            <time>
              {new Date(post.date).toLocaleDateString('pt-BR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </time>
            <span>•</span>
            <span>{post.author}</span>
          </div>
          {post.tags && post.tags.length > 0 && (
            <div className="flex gap-2 mt-3">
              {post.tags.map((tag) => (
                <span key={tag} className="text-[10px] bg-white/10 text-white/80 rounded-full px-2 py-0.5">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      <article className="max-w-2xl mx-auto px-4 py-8 prose prose-sm prose-gray">
        <MDXRemote source={post.content} />
      </article>

      <div className="max-w-2xl mx-auto px-4 pb-12">
        <Link
          href="/blog"
          className="text-sm text-brand font-medium hover:text-brand-dark transition"
        >
          &larr; Voltar ao Blog
        </Link>
      </div>
    </main>
  )
}
