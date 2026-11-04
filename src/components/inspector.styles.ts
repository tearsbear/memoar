import * as stylex from '@stylexjs/stylex';

export const inspectorStyles = stylex.create({
  panel: {
    minWidth: 0,
    width: '100%',
    backgroundColor: 'var(--color-background-surface)',
  },
  action: { minHeight: 44 },
  postUrlControl: {
    boxShadow: { default: null, ':focus-within': 'none' },
  },
});
