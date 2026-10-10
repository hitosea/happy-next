import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['sources/**/*.{spec,test}.ts'],
        // CI runners (notably Windows x64) can stall a trivial test past the 5s default.
        testTimeout: process.env.CI ? 30_000 : 5_000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/**',
                'dist/**',
                '**/*.d.ts',
                '**/*.config.*',
                '**/mockData/**',
            ],
        },
    },
    resolve: {
        alias: {
            '@': resolve('./sources'),
        },
    },
})