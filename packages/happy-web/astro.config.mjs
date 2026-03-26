import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://happy-next.com',
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: [
        '.coder.hitosea.com',
      ],
    },
  },
});
