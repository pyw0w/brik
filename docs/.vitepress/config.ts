import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Brik',
  description: 'Модульный Discord-бот на TypeScript',
  lang: 'ru',
  themeConfig: {
    nav: [
      { text: 'Гайды', link: '/guides/getting-started' },
    ],
    sidebar: [
      {
        text: 'Гайды',
        items: [
          { text: 'Getting Started', link: '/guides/getting-started' },
          { text: 'Первый модуль', link: '/guides/your-first-module' },
          { text: 'Справочник API', link: '/guides/module-api' },
          { text: 'Dev-режим', link: '/guides/dev-mode' },
        ],
      },
      {
        text: 'Для агентов',
        items: [
          { text: 'AI-агент: гайд по проекту', link: '/llm' },
        ],
      },
    ],
  },
});
