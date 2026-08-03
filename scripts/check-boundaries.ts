import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Проверка границ: модули импортируют только публичный контракт ядра.
 * Запрещено: discord.js, core/internal/*, core/discord/* и любые пути в core,
 * кроме core/index.ts и core/testing.ts. Запуск: bun run check:boundaries.
 */

const MODULES_DIR = 'src/modules';
const ALLOWED_CORE = new Set([
  '../../core/index.ts',
  '../../core/index.js',
  '../../core/testing.ts',
  '../../core/testing.js',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs = new Set<string>();
  const re = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const spec = m[1];
    if (spec === undefined) continue;
    if (spec.startsWith('.')) specs.add(spec);
  }
  return [...specs];
}

const failures: string[] = [];

for (const file of walk(MODULES_DIR)) {
  for (const spec of importsOf(file)) {
    if (spec.includes('discord.js')) {
      failures.push(`${file}: запрещён прямой импорт discord.js («${spec}»); используйте только core/index.ts`);
    }
    if (spec.startsWith('../../core/') && ![...ALLOWED_CORE].some((a) => spec === a)) {
      failures.push(
        `${file}: импорт вне публичного контракта («${spec}»); разрешены только core/index.ts и core/testing.ts`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('Нарушение границ модулей:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`Границы ок: ${walk(MODULES_DIR).length} файлов модулей, все импорты в рамках контракта.`);
