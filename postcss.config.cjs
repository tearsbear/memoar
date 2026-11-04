const babelConfig = require('./babel.config.json');

module.exports = {
  plugins: {
    '@stylexjs/postcss-plugin': {
      include: ['src/**/*.{ts,tsx}'],
      babelConfig: {
        babelrc: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: babelConfig.plugins,
        env: babelConfig.env,
      },
      useCSSLayers: { before: ['reset', 'astryx-base', 'astryx-theme'] },
    },
    autoprefixer: {},
  },
};
