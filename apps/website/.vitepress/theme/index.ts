import type { Theme } from 'vitepress';
import { h } from 'vue';
import DefaultTheme from 'vitepress/theme';
import HomeBelowFold from './components/HomeBelowFold.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-features-after': () => h(HomeBelowFold),
    });
  },
} satisfies Theme;
