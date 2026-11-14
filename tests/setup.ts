import '@testing-library/jest-dom/vitest'

process.env.SESSION_SECRET ??= 'test-only-session-secret-with-at-least-32-characters'
