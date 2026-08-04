import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Brik',
  description: 'Модульный Discord-бот на TypeScript',
  lang: 'ru',
  // docs/superpowers — внутренние рабочие материалы агентов, в документацию не входят.
  srcExclude: ['**/superpowers/**/*.md'],
  themeConfig: {
    nav: [
      { text: 'Гайды', link: '/guides/getting-started' },
      { text: 'Справочник', link: '/reference/modules' },
    ],
    sidebar: [
      {
        text: 'Начало работы',
        items: [
          { text: 'Getting Started', link: '/guides/getting-started' },
          { text: 'Первый модуль', link: '/guides/your-first-module' },
          { text: 'Dev-режим', link: '/guides/dev-mode' },
        ],
      },
      {
        text: 'Гайды разработчика',
        items: [
          { text: 'Архитектура и слои', link: '/guides/architecture' },
          { text: 'Справочник API', link: '/guides/module-api' },
          { text: 'Тестирование', link: '/guides/testing' },
        ],
      },
      {
        text: 'Справочник',
        items: [
          { text: 'Модули и команды', link: '/reference/modules' },
        ],
      },
      {
        text: 'Эксплуатация',
        items: [
          { text: 'Развёртывание и настройка', link: '/guides/operations' },
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
