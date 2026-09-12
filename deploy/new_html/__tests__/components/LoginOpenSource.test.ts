import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps the repository invitation accessible outside the dynamic login form', () => {
  const html = readFileSync(resolve(process.cwd(), '../login.html'), 'utf8');
  const page = new DOMParser().parseFromString(html, 'text/html');
  const link = page.querySelector<HTMLAnchorElement>('a.open-source-link')!;
  expect(link.textContent).toBe('本产品已开源，助力点亮Star');
  expect(link.getAttribute('href')).toBe('https://github.com/WuKongOpenSource/SceneGo');
  expect(link.target).toBe('_blank');
  expect(link.rel).toBe('noopener noreferrer');
  expect(link.closest('form')).toBeNull();
  expect(page.querySelector('#authFooter')?.nextElementSibling).toBe(link);
});
