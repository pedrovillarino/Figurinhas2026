import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')

export type BlogPost = {
  slug: string
  title: string
  description: string
  date: string
  author: string
  image?: string
  tags?: string[]
  content: string
}

export type BlogPostMeta = Omit<BlogPost, 'content'>

/** Get all blog post slugs */
export function getBlogSlugs(): string[] {
  if (!fs.existsSync(BLOG_DIR)) return []
  return fs
    .readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.mdx') || f.endsWith('.md'))
    .map((f) => f.replace(/\.mdx?$/, ''))
}

/** Get a single blog post by slug */
export function getBlogPost(slug: string): BlogPost | null {
  const mdxPath = path.join(BLOG_DIR, `${slug}.mdx`)
  const mdPath = path.join(BLOG_DIR, `${slug}.md`)

  const filePath = fs.existsSync(mdxPath) ? mdxPath : fs.existsSync(mdPath) ? mdPath : null
  if (!filePath) return null

  const raw = fs.readFileSync(filePath, 'utf-8')
  const { data, content } = matter(raw)

  return {
    slug,
    title: data.title || slug,
    description: data.description || '',
    date: data.date || '',
    author: data.author || 'Equipe Complete Aí',
    image: data.image || undefined,
    tags: data.tags || [],
    content,
  }
}

/** Get all blog posts sorted by date (newest first) */
export function getAllBlogPosts(): BlogPostMeta[] {
  const slugs = getBlogSlugs()
  const posts = slugs
    .map((slug) => {
      const post = getBlogPost(slug)
      if (!post) return null
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { content, ...meta } = post
      return meta
    })
    .filter(Boolean) as BlogPostMeta[]

  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}
