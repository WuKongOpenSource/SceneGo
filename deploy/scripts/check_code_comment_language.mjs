#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';


const require = createRequire(import.meta.url);
const parser = require('../new_html/node_modules/@babel/parser');
const HAN_CHARACTER = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff。！？；：（），、【】“”‘’《》]/;
const LOW_VALUE_SEPARATOR = /^[-=_*#─━═—–]{3,}$/;
const LOW_VALUE_HEADING = /^(?:[-=_*#─━═—–]{2,}\s*.+?\s*[-=_*#─━═—–]{2,}|(?:🆕\s*)?(?:new\s+)?[a-z0-9 &/()'.-]+\s+(?:state(?:\s*\([^)]*\))?|operations|management|logic|types|strategies(?:\s*\([^)]*\))?))$/i;
const LOW_VALUE_PATH = /^(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:py|ts|tsx|js|jsx|mjs|cjs|css|scss|sh|ps1)$/i;
const SCRIPT_SUFFIXES = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);


function lineAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}


function parserPlugins(suffix) {
  const plugins = ['jsx'];
  if (suffix === '.ts' || suffix === '.tsx') plugins.push('typescript');
  return plugins;
}


function commentBody(value) {
  return String(value || '')
    .trim()
    .replace(/^(?:<!--|\/\*|\/\/|#|::)\s*/, '')
    .replace(/^REM\s+/i, '')
    .replace(/\s*(?:-->|\*\/)$/, '')
    .trim();
}


function commentIssueKind(value, generated) {
  if (HAN_CHARACTER.test(value)) return 'comment';
  const body = commentBody(value);
  if (!generated && (LOW_VALUE_SEPARATOR.test(body) || LOW_VALUE_HEADING.test(body) || LOW_VALUE_PATH.test(body))) {
    return 'nonessential comment';
  }
  return null;
}


function parseScript(source, suffix, pathName, lineOffset = 0) {
  const issues = [];
  const generated = /\bGENERATED\b.*do not edit/i.test(source.slice(0, 200));
  let tree;
  try {
    tree = parser.parse(source, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: parserPlugins(suffix),
    });
  } catch {
    return [{ path: pathName, line: Math.max(1, lineOffset + 1), kind: 'parse error' }];
  }
  if (tree.errors?.length) {
    issues.push({ path: pathName, line: Math.max(1, lineOffset + 1), kind: 'parse error' });
  }
  for (const comment of tree.comments || []) {
    const kind = commentIssueKind(comment.value, generated);
    if (kind) {
      issues.push({
        path: pathName,
        line: lineOffset + comment.loc.start.line,
        kind,
      });
    }
  }
  return issues;
}


function scanHtml(source, pathName) {
  const issues = [];
  const generated = /\bGENERATED\b.*do not edit/i.test(source.slice(0, 200));
  for (const match of source.matchAll(/<!--[\s\S]*?-->/g)) {
    const kind = commentIssueKind(match[0], generated);
    if (kind) {
      issues.push({ path: pathName, line: lineAt(source, match.index), kind });
    }
  }
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] || '';
    const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
    const script = match[2] || '';
    const scriptOffset = match.index + match[0].indexOf(script);
    issues.push(...parseScript(script, '.js', pathName, lineAt(source, scriptOffset) - 1));
  }
  return issues;
}


const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const root = path.resolve(input.root);
const issues = [];
for (const relativePath of input.paths || []) {
  const normalized = relativePath.replaceAll('\\', '/');
  const absolutePath = path.resolve(root, normalized);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) continue;
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
  const source = fs.readFileSync(absolutePath, 'utf8');
  const suffix = path.extname(normalized).toLowerCase();
  if (SCRIPT_SUFFIXES.has(suffix)) {
    issues.push(...parseScript(source, suffix, normalized));
    const generated = /\bGENERATED\b.*do not edit/i.test(source.slice(0, 200));
    for (const match of source.matchAll(/<!--[\s\S]*?-->/g)) {
      const kind = commentIssueKind(match[0], generated);
      if (kind) {
        issues.push({ path: normalized, line: lineAt(source, match.index), kind });
      }
    }
  } else if (suffix === '.html' || suffix === '.htm') {
    issues.push(...scanHtml(source, normalized));
  }
}

process.stdout.write(JSON.stringify(issues));
