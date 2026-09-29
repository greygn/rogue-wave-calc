import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ base: '/rogue-wave-calc/', plugins: [react()] });
