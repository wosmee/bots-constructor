// Метаданные элементов мини-аппа: зеркало BLOCK_META конструктора ботов.
// Цвета закреплены один раз и НЕ меняются последующими промптами/макетами —
// по ним палитра и узлы читаются как семейства. Оттенки внутри группы — один
// сектор круга, чтобы группа виделась родственной, но элементы не сливались.
// label/hint/whatif — TKey-ключи i18n (фрагмент mini), читаются через t().
import type { MiniElementType, MiniPaletteGroupId } from '../../shared/miniapp';

export interface MiniElementMeta {
  label: string; // TKey
  hint: string; // TKey
  whatif: string; // TKey
  color: string; // закреплён
}

export const MINI_ELEMENT_META: Record<MiniElementType, MiniElementMeta> = {
  // content — синий сектор
  text: { label: 'miniEl.text.label', hint: 'miniEl.text.hint', whatif: 'miniEl.text.whatif', color: '#3b82f6' },
  heading: { label: 'miniEl.heading.label', hint: 'miniEl.heading.hint', whatif: 'miniEl.heading.whatif', color: '#2563eb' },
  image: { label: 'miniEl.image.label', hint: 'miniEl.image.hint', whatif: 'miniEl.image.whatif', color: '#60a5fa' },
  card: { label: 'miniEl.card.label', hint: 'miniEl.card.hint', whatif: 'miniEl.card.whatif', color: '#93c5fd' },
  divider: { label: 'miniEl.divider.label', hint: 'miniEl.divider.hint', whatif: 'miniEl.divider.whatif', color: '#bfdbfe' },
  spacer: { label: 'miniEl.spacer.label', hint: 'miniEl.spacer.hint', whatif: 'miniEl.spacer.whatif', color: '#dbeafe' },
  // forms — фиолетовый сектор
  input: { label: 'miniEl.input.label', hint: 'miniEl.input.hint', whatif: 'miniEl.input.whatif', color: '#8b5cf6' },
  form: { label: 'miniEl.form.label', hint: 'miniEl.form.hint', whatif: 'miniEl.form.whatif', color: '#7c3aed' },
  button: { label: 'miniEl.button.label', hint: 'miniEl.button.hint', whatif: 'miniEl.button.whatif', color: '#a78bfa' },
  product: { label: 'miniEl.product.label', hint: 'miniEl.product.hint', whatif: 'miniEl.product.whatif', color: '#c4b5fd' },
  // data — янтарный сектор
  grid: { label: 'miniEl.grid.label', hint: 'miniEl.grid.hint', whatif: 'miniEl.grid.whatif', color: '#f59e0b' },
  chips: { label: 'miniEl.chips.label', hint: 'miniEl.chips.hint', whatif: 'miniEl.chips.whatif', color: '#d97706' },
  search: { label: 'miniEl.search.label', hint: 'miniEl.search.hint', whatif: 'miniEl.search.whatif', color: '#b45309' },
  sort: { label: 'miniEl.sort.label', hint: 'miniEl.sort.hint', whatif: 'miniEl.sort.whatif', color: '#fbbf24' },
  stat: { label: 'miniEl.stat.label', hint: 'miniEl.stat.hint', whatif: 'miniEl.stat.whatif', color: '#fcd34d' },
  table: { label: 'miniEl.table.label', hint: 'miniEl.table.hint', whatif: 'miniEl.table.whatif', color: '#92400e' },
  record_form: { label: 'miniEl.record_form.label', hint: 'miniEl.record_form.hint', whatif: 'miniEl.record_form.whatif', color: '#78350f' },
  user_list: { label: 'miniEl.user_list.label', hint: 'miniEl.user_list.hint', whatif: 'miniEl.user_list.whatif', color: '#fde68a' },
  user_info: { label: 'miniEl.user_info.label', hint: 'miniEl.user_info.hint', whatif: 'miniEl.user_info.whatif', color: '#fef3c7' },
  support: { label: 'miniEl.support.label', hint: 'miniEl.support.hint', whatif: 'miniEl.support.whatif', color: '#a16207' },
  refresh: { label: 'miniEl.refresh.label', hint: 'miniEl.refresh.hint', whatif: 'miniEl.refresh.whatif', color: '#ca8a04' },
  // integrations — зелёный сектор
  ai_gen: { label: 'miniEl.ai_gen.label', hint: 'miniEl.ai_gen.hint', whatif: 'miniEl.ai_gen.whatif', color: '#10b981' },
  // фаза D: richtext — зелёный сектор integrations (рядом с ai_gen, свой оттенок);
  // carousel/video — синий сектор content: в палитре они в группе 'content'.
  richtext: { label: 'miniEl.richtext.label', hint: 'miniEl.richtext.hint', whatif: 'miniEl.richtext.whatif', color: '#059669' },
  carousel: { label: 'miniEl.carousel.label', hint: 'miniEl.carousel.hint', whatif: 'miniEl.carousel.whatif', color: '#1d4ed8' },
  video: { label: 'miniEl.video.label', hint: 'miniEl.video.hint', whatif: 'miniEl.video.whatif', color: '#0ea5e9' },
};

// Группа «Продвинутые» палитры мини-аппов: у skill_level 'low' скрыта до
// тумблера advanced_blocks, как у палитры ботов.
export function isAdvancedMiniGroup(id: MiniPaletteGroupId): boolean {
  return id === 'advanced';
}
