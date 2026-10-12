import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseYaml, createBrand, renderIndexHtml } from './src/lib/brand.js'

// index.html 是静态入口，无法直接 import brand.yml，因此在构建时读取并注入。
function loadBrand() {
  const brandPath = fileURLToPath(new URL('./src/data/brand.yml', import.meta.url))
  const [config] = parseYaml(readFileSync(brandPath, 'utf8'))
  return createBrand(config)
}

function whiteLabelHtml() {
  return {
    name: 'white-label-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return renderIndexHtml(html, loadBrand())
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), whiteLabelHtml()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/uploads": "http://127.0.0.1:3000",
    },
  },
})
