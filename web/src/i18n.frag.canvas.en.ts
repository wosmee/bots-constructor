// EN-фрагмент словаря: визуальные группы холста, поиск, конфликты (Промпт 2).
// Тип обязан повторять RU-фрагмент: расхождение RU/EN не компилируется.
import { CANVAS_RU } from './i18n.frag.canvas';

export const CANVAS_EN: Record<keyof typeof CANVAS_RU, string> = {
  'conflict.waitNoTimeout': '“Wait for reply” has no timeout branch: the flow hangs if the user stays silent',
  'conflict.noFailPath': 'Payment check has no “failed” branch: a cancelled or broken payment slips past the flow',
  'conflict.broadcastEmpty': 'Broadcast has no “empty” branch: the flow stops if the segment matches nobody',
  'conflict.list.warnings': 'Warnings',

  'ctx.group': 'Group',
  'group.defaultTitle': 'Group',
  'group.aria': 'Visual block group',
  'group.panel.aria': 'Group panel',
  'group.rename.title': 'Rename group',
  'group.rename.placeholder': 'Group name',
  'group.color.title': 'Group color',
  'group.collapse.title': 'Collapse group',
  'group.expand.title': 'Expand group',
  'group.delete.title': 'Delete group (blocks stay)',
  'group.move.title': 'Drag to move the group with its blocks',
  'group.resize.title': 'Drag to resize the group',
  'status.grouped': 'Grouped blocks: {n}',
  'status.ungrouped': 'Group removed, blocks kept on canvas',

  'canvas.loading': 'Loading scenario…',
  'canvas.renderError': 'Could not render the canvas: {message}',
};
