#!/usr/bin/env node
import puppeteer from 'puppeteer'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 2 })

  for (let i = 1; i <= 8; i++) {
    const htmlPath = resolve(__dirname, `slide-${i}.html`)
    const pngPath = resolve(__dirname, `slide-${i}.png`)

    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle2', timeout: 15000 })
    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready)
    await new Promise(r => setTimeout(r, 500))

    await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: 1080, height: 1080 } })
    console.log(`✅ slide-${i}.png`)
  }

  await browser.close()
  console.log('\n🎉 Todos os 8 slides gerados na pasta marketing/')
}

main().catch(err => { console.error(err); process.exit(1) })
