import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const html = readFileSync(resolve(process.cwd(), '../login.html'), 'utf8');

it('places one accessible repository text link below and outside the login card', () => {
  const page = new DOMParser().parseFromString(html, 'text/html');
  const link = page.querySelector<HTMLAnchorElement>('a.open-source-link')!;
  expect(link.textContent).toBe('本产品已开源，助力点亮Star');
  expect(link.getAttribute('href')).toBe('https://github.com/WuKongOpenSource/SceneGo');
  expect(link.target).toBe('_blank');
  expect(link.rel).toBe('noopener noreferrer');
  expect(link.closest('form')).toBeNull();
  expect(link.closest('.login-card')).toBeNull();
  expect(page.querySelector('.login-card')?.nextElementSibling).toBe(link);
  expect(link.parentElement?.className).toBe('login-panel');
  expect(page.querySelectorAll('a.open-source-link')).toHaveLength(1);
  expect(link.children).toHaveLength(0);
});

it('uses single-line unboxed text with visible hover and keyboard focus feedback', () => {
  const rule = html.match(/\.open-source-link\s*\{([^}]+)\}/)![1];
  expect(rule).toMatch(/padding:\s*0;/);
  expect(rule).toMatch(/border:\s*0;/);
  expect(rule).toMatch(/background:\s*transparent;/);
  expect(rule).toMatch(/white-space:\s*nowrap;/);
  expect(rule).toMatch(/align-self:\s*center;/);
  expect(rule).not.toMatch(/border-radius|box-shadow/);
  expect(html).toMatch(/\.login-panel\s*\{[^}]*flex-direction:\s*column;/);
  expect(html).toMatch(/\.open-source-link:hover\s*\{\s*text-decoration:\s*underline;\s*\}/);
  expect(html).toMatch(/\.open-source-link:focus-visible\s*\{[^}]*text-decoration:\s*underline dotted 2px;/);
});
