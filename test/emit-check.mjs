/**
 * Does the source the editor emits actually compile?
 *
 * The unit tests check that the emitter writes the right *strings*, which is
 * necessary and not sufficient: a figure's whole promise is that what comes
 * out of the Code drawer can be committed as it stands. So this takes every
 * worked example, emits it both ways, and hands the result to the same
 * TypeScript compiler the library holds itself to — strict, exactOptional,
 * noUnchecked and all — against the real configs it claims to be building.
 *
 * The `.astro` target is emitted as a component, and what is typechecked is
 * its `<script>` block, which is where all of the TypeScript in an Astro
 * component lives. Run with `npm run emit-check`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.emit-check');

const { emitDocument } = await import('../.test-out/canvas-diagram/editor/emit.js');
const { EXAMPLES } = await import('../.test-out/canvas-diagram/editor/examples/index.js');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The emitted files sit one level down from the kit, exactly as a real figure
// in `components/` does, so the relative imports they are given are the ones a
// committed figure would actually use.
const opts = { from: '../canvas-diagram', rendererImport: '../canvas-diagram/editor' };
const written = [];

for (const example of EXAMPLES) {
  const doc = example.doc();

  const scene = emitDocument(doc, { ...opts, target: 'scene' });
  writeFileSync(join(out, scene.filename), scene.code);
  written.push(scene.filename);

  const component = emitDocument(doc, { ...opts, target: 'component' });
  const script = component.code.match(/<script>\n([\s\S]*?)\n<\/script>/);
  if (!script) throw new Error(`${example.name}: the emitted component has no script block`);
  const name = component.filename.replace(/\.astro$/, 'Component.ts');
  writeFileSync(join(out, name), script[1]);
  written.push(name);
}

writeFileSync(
  join(out, 'tsconfig.json'),
  JSON.stringify(
    { extends: '../tsconfig.json', compilerOptions: { noEmit: true }, include: ['*.ts'] },
    null,
    2,
  ) + '\n',
);

console.log(`emitted ${written.length} files:\n  ${written.join('\n  ')}`);

try {
  execFileSync('npx', ['tsc', '--noEmit', '-p', out], { cwd: root, stdio: 'inherit', shell: true });
  console.log('\nAll emitted sources typecheck.');
} catch {
  console.error('\nThe emitted sources do NOT typecheck — see above. They are left in .emit-check/ to look at.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
