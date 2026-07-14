import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.{test,spec}.{ts,tsx}'],
    // React 17+ JSX transform — no need to import React in every file,
    // but explicit imports also work and are more portable.
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/components/**', 'src/pages/**', 'src/utils/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    jsxInject: `import React from 'react'`,
  },
})
