import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(
  defineConfig({
  title: 'Vazue Queue',
  description: 'Open source virtual waiting room on AWS — fair FIFO queue, CDK deploy, admit tokens, honest capacity docs',
  lang: 'en-US',
  base: '/',
  // S3 + CloudFront static hosting: emit *.html paths (no cleanUrls rewrite required).
  cleanUrls: false,
  head: [
    ['link', { rel: 'canonical', href: 'https://queue.vazue.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,700&family=Manrope:wght@400;600;700&display=swap',
      },
    ],
  ],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Docs', link: '/docs/', activeMatch: '/docs/' },
      { text: 'Why Vazue', link: '/docs/introduction/why-vazue' },
      { text: 'Open Source', link: '/oss' },
      { text: 'Pricing', link: '/pricing' },
      {
        text: 'GitHub',
        link: 'https://github.com/manyiu/vazue-queue',
      },
    ],
    sidebar: {
      '/docs/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Overview', link: '/docs/' },
            { text: 'Why Vazue Queue', link: '/docs/introduction/why-vazue' },
          ],
        },
        {
          text: 'Getting started',
          items: [
            { text: 'Quickstart', link: '/docs/getting-started/quickstart' },
            { text: 'Local development', link: '/docs/getting-started/local-development' },
          ],
        },
        {
          text: 'Concepts',
          items: [
            { text: 'Architecture', link: '/docs/concepts/architecture' },
            { text: 'Visitor flow', link: '/docs/concepts/visitor-flow' },
            { text: 'Presets', link: '/docs/concepts/presets' },
            { text: 'Data model', link: '/docs/concepts/data-model' },
            { text: 'Fairness & throughput', link: '/docs/concepts/fairness-and-throughput' },
            { text: 'Security', link: '/docs/concepts/security' },
          ],
        },
        {
          text: 'Guides',
          items: [
            { text: 'Deploy with CDK', link: '/docs/guides/deploy' },
            { text: 'AWS cost estimate', link: '/docs/guides/cost' },
            { text: 'Capacity planning', link: '/docs/guides/capacity' },
            { text: 'Operations', link: '/docs/guides/operations' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Configuration', link: '/docs/reference/config' },
            { text: 'Queue API', link: '/docs/reference/api' },
            { text: 'SDKs', link: '/docs/reference/sdks' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/manyiu/vazue-queue' },
    ],
    search: { provider: 'local' },
    footer: {
      message: 'Apache-2.0 for published open source packages',
      copyright: 'Copyright © Vazue Queue',
    },
  },
  mermaid: {
    theme: 'neutral',
  },
  }),
);
