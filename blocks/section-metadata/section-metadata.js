/*
 * Section Metadata Block
 * Applies styles and layout options to the section that contains it.
 * Supported keys: style, grid, gap, spacing, container, layout, background.
 * Other keys are added to the section as data attributes.
 * Ported from https://github.com/aemsites/author-kit
 */

import { readBlockConfig, toClassName, toCamelCase } from '../../scripts/aem.js';

function getRelativeLuminance({ r, g, b }) {
  const [rl, gl, bl] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

export function setColorScheme(section) {
  const match = getComputedStyle(section).backgroundColor
    .match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match || match[4] === '0') return;
  const [, r, g, b] = match.map(Number);
  const scheme = getRelativeLuminance({ r, g, b }) > 0.5 ? 'light-scheme' : 'dark-scheme';
  section.classList.remove('light-scheme', 'dark-scheme');
  section.classList.add(scheme);
}

function handleBackground(background, section) {
  if (/^(https?:)?\/|^\.\//.test(background)) {
    const url = new URL(background, window.location.href);
    if (url.pathname.endsWith('.mp4')) return;
    const pic = document.createElement('picture');
    pic.className = 'section-background';
    const img = document.createElement('img');
    img.src = url.href;
    img.alt = '';
    img.loading = 'lazy';
    pic.append(img);
    section.classList.add('has-background');
    section.prepend(pic);
    return;
  }

  section.style.backgroundColor = background.startsWith('color-token')
    ? `var(${background.replace('color-token', '--color')})`
    : background;
  setColorScheme(section);
}

function wrapBlockContent(section) {
  const wrappers = [...section.querySelectorAll(':scope > div:not(.default-content-wrapper)')];
  if (!wrappers.length) return;
  const blockContent = document.createElement('div');
  blockContent.className = 'block-content';
  wrappers[0].before(blockContent);
  blockContent.append(...wrappers);
}

export default function decorate(block) {
  const section = block.closest('.section');
  const config = readBlockConfig(block);
  const wrapper = block.parentElement;
  block.remove();
  if (wrapper && !wrapper.children.length) wrapper.remove();
  if (!section) return;

  Object.entries(config).forEach(([key, value]) => {
    const val = String(value).trim();
    if (!val) return;
    switch (key) {
      case 'style':
        val.split(',').map((s) => toClassName(s.trim())).filter(Boolean)
          .forEach((cls) => section.classList.add(cls));
        break;
      case 'grid':
      case 'gap':
      case 'spacing':
      case 'container':
      case 'layout':
        if (val === '0') break;
        if (key === 'grid' || key === 'container') section.classList.add(key);
        section.classList.add(`${key}-${toClassName(val)}`);
        break;
      case 'background':
        handleBackground(val, section);
        break;
      default:
        section.dataset[toCamelCase(key)] = val;
    }
  });

  if (section.matches('.grid, .container, [class*="layout-"]')) wrapBlockContent(section);
}
