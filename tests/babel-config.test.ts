import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getBabelConfigFile } from 'next/dist/build/get-babel-config-file';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const babel = require('next/dist/compiled/babel/core') as {
  transformSync: (source: string, options: Record<string, unknown>) => { code?: string } | null;
  loadOptions: (options: Record<string, unknown>) => {
    plugins: Array<{ key: string; options: { dev?: boolean; runtimeInjection?: boolean } }>;
  };
};

describe('Next.js Babel configuration compatibility', () => {
  it.each(['development', 'production'].flatMap(envName =>
    ['components/inspector.styles.ts', 'components/post-inspector.tsx', 'components/capture-import.tsx', 'components/extracted-data.tsx', 'lib/capture/normalize.ts'].map(relative => ({ envName, relative }))
  ))('transforms $relative in $envName with the installed Next Babel preset', ({ envName, relative }) => {
    const filename = fileURLToPath(new URL(`../src/${relative}`, import.meta.url));
    const result = babel.transformSync(readFileSync(filename, 'utf8'), {
      cwd: root, filename, configFile: getBabelConfigFile(root), envName,
      caller: { name: 'next-babel-turbo-loader', supportsStaticESM: true, supportsDynamicImport: true, supportsTopLevelAwait: true, isServer: false, isDev: envName === 'development' },
    });
    expect(result?.code).toBeTruthy();
  });

  it.each(['development', 'production'])('loads the discovered JSON config in %s mode', envName => {
    const configFile = getBabelConfigFile(root);
    expect(configFile).toBe(fileURLToPath(new URL('../babel.config.json', import.meta.url)));
    const options = babel.loadOptions({
      cwd: root,
      filename: fileURLToPath(new URL('../src/components/inspector.styles.ts', import.meta.url)),
      configFile,
      envName,
      caller: { name: 'next-babel-turbo-loader', supportsStaticESM: true, supportsDynamicImport: true, supportsTopLevelAwait: true, isServer: false, isDev: envName === 'development' },
    });
    const stylex = options.plugins.find(plugin => plugin.key === 'stylex');
    expect(stylex?.options).toMatchObject({ dev: envName !== 'production', runtimeInjection: false });
  });

  it('loads the same StyleX options for PostCSS', () => {
    const postcss = require('../postcss.config.cjs');
    const babelConfig = require('../babel.config.json');
    expect(postcss.plugins['@stylexjs/postcss-plugin'].babelConfig).toMatchObject({
      plugins: babelConfig.plugins,
      env: babelConfig.env,
    });
  });
});
