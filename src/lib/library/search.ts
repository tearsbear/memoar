import type { SavedPost } from './types';

export const normalizeTerm = (text: string) => text.normalize('NFKC').toLowerCase().replace(new RegExp('[^\\p{L}\\p{N}]+', 'gu'), ' ').trim();
export const postTitle = (post: SavedPost) => post.enrichment?.slides.find(slide => slide.summary)?.summary || post.capture.inspection.fields.captionText.value || post.capture.inspection.fields.textContent.value || 'Saved post';
export function searchFields(post: SavedPost): { text: string; weight: number }[] {
  const e = post.enrichment, f = post.capture.inspection.fields;
  return [
    { text: [e?.category, ...(e?.topics ?? []), ...(e?.searchableKeywords ?? [])].filter(Boolean).join(' '), weight: 6 },
    { text: [...(e?.visibleText ?? []), ...(e?.brands.map(brand => brand.name) ?? []), ...(e?.objects.flatMap(object => [object.name, object.type, ...object.attributes]) ?? []), ...(e?.visualKeywords ?? [])].filter(Boolean).join(' '), weight: 4 },
    { text: [f.captionText.value, f.textContent.value, f.authorHandle.value, ...(f.hashtags.value ?? []), e?.captionContext.summary, ...(e?.captionContext.productNames ?? []), ...(e?.slides.flatMap(slide => [slide.summary, ...slide.keyInsights]) ?? [])].filter(Boolean).join(' '), weight: 2 },
  ].map(field => ({ ...field, text: normalizeTerm(field.text) }));
}
export function searchScore(post: SavedPost, chips: string[]): number {
  const fields = searchFields(post);
  let score = 0;
  for (const chip of chips) {
    const term = normalizeTerm(chip);
    if (!term) continue;
    const tokens = term.split(' ');
    const matches = fields.reduce((sum, field) => sum + (field.text.includes(term) ? field.weight * 3 : tokens.every(token => field.text.split(' ').includes(token)) ? field.weight : 0), 0);
    if (!matches) return 0;
    score += matches;
  }
  return score || (chips.length ? 0 : 1);
}
export function collections(posts: SavedPost[]) {
  const groups = new Map<string, { id: string; title: string; posts: SavedPost[] }>();
  const accents = /[\u0300-\u036f]/;
  for (const post of posts) {
    const enrichment = post.enrichment;
    if (!enrichment) continue;
    const subjects = [enrichment.category, ...enrichment.topics, ...enrichment.objects.map(object => object.type)].filter((value): value is string => Boolean(value));
    const drinks = subjects.some(subject => /\b(drinks?|beverages?|coffee|tea|soda|frappes?|smoothies?)\b/.test(normalizeTerm(subject)));
    const category = drinks ? 'Drinks' : enrichment.category;
    // Collections are browsing groups; detailed topics stay in the search index.
    for (const name of [category, ...enrichment.brands.map(brand => brand.name)].filter((value): value is string => Boolean(value?.trim()))) {
      const title = name.replace(/\s*\(@[A-Za-z0-9_.]+\)\s*$/, '').replace(/\s+/g, ' ').trim();
      const id = normalizeTerm(title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, ''));
      if (!id || id.length > 100) continue;
      const group = groups.get(id) ?? { id, title, posts: [] };
      if (accents.test(title.normalize('NFD')) && !accents.test(group.title.normalize('NFD'))) group.title = title;
      if (!group.posts.some(member => member.id === post.id)) group.posts.push(post);
      groups.set(id, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.posts.length - a.posts.length || a.title.localeCompare(b.title));
}
export function relatedPosts(post: SavedPost, posts: SavedPost[]) {
  const enrichment = post.enrichment;
  const terms = enrichment ? [enrichment.category, ...enrichment.topics, ...enrichment.searchableKeywords, ...enrichment.brands.map(brand => brand.name), ...enrichment.visualKeywords].filter((value): value is string => Boolean(value)) : [];
  const fallback = [...new Set(normalizeTerm(postTitle(post)).split(' ').filter(word => word.length > 4))].slice(0, 10);
  const unique = [...new Set((terms.length ? terms : fallback).map(normalizeTerm))];
  return posts.filter(candidate => candidate.id !== post.id).map(candidate => ({ post: candidate, score: unique.reduce((score, term) => score + searchScore(candidate, [term]), 0) })).filter(result => result.score >= (terms.length ? 6 : 12)).sort((a, b) => b.score - a.score).slice(0, 5).map(result => result.post);
}
