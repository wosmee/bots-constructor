// EN-фрагмент словаря: подсценарии.
// Тип обязан повторять RU-фрагмент: Record<keyof typeof SUBFLOW_RU, string> —
// расхождение RU/EN не компилируется.
import { SUBFLOW_RU } from './i18n.frag.subflow';

export const SUBFLOW_EN: Record<keyof typeof SUBFLOW_RU, string> = {
  'block.subflow.label': 'Subflow',
  'block.subflow.hint': 'Calls a fragment from your library: “send the menu”, “take payment” — build once, use everywhere. At publish time the fragment expands into plain blocks.',
  'block.subflow.example': 'Move “show the main menu” into a subflow and call it from 20 places instead of copying 12 blocks.',
  'whatif.subflow': 'Fill both branches: “done” and “failed”. Inside the fragment, control returns via the “Return” block.',

  'block.subflow_return.label': 'Return',
  'block.subflow_return.hint': 'End of the fragment: control returns to the calling bot (the “done” branch). Outputs are copied into the bot’s variables.',
  'block.subflow_return.example': 'The “take payment” fragment ends with a return carrying the paid output — the caller reads {{paid}}.',
  'whatif.subflow_return': 'A return finishes the fragment — it has no outgoing arrows.',

  'node.subflow': '→ {name}',
  'node.subflow.rev': '→ {name} (rev {rev})',
  'node.subflow_return': 'return',
  'node.subflow_return.outputs': 'return · {n} out',

  'port.sfDone': 'done',
  'port.sfFailed': 'failed',

  'f.sf.fragment': 'Library fragment',
  'f.sf.loading': 'loading…',
  'f.sf.none': '— pick a fragment —',
  'f.sf.empty': 'No fragments yet. Create one on the “Library” page or select blocks on the canvas → “Create subflow from selection”.',
  'f.sf.alias': 'Call label (alias)',
  'f.sf.alias.hint': 'Part of the expanded block and variable names (sf.<alias>.…). Two calls of the same fragment are told apart by this label.',
  'f.sf.revision': 'Fragment revision',
  'f.sf.revision.latest': 'latest (rev {rev})',
  'f.sf.revision.hint': 'A pinned revision makes publishing predictable: library edits won’t change this call until you update the revision explicitly.',
  'f.sf.inputs': 'Fragment inputs',
  'f.sf.outputs': 'Fragment outputs',
  'f.sf.outputs.hint': 'Where to put the output value in the bot’s variables (defaults to the same name).',
  'f.sf.required': 'required',
  'f.sf.scope': 'Fragment variables',
  'f.sf.scope.isolated': 'isolated (recommended)',
  'f.sf.scope.shared': 'shared with the bot',
  'f.sf.scope.hint': 'In isolated mode the fragment’s variables are named sf.<alias>.<var> and never clash with the bot’s; only declared outputs leave the fragment.',
  'f.sf.scope.warn': 'Careful: a shared fragment can overwrite bot variables with the same names. This is intentional — use it when the fragment must write straight into scenario variables.',
  'f.sf.note': 'The call expands at publish time: the live bot runs a snapshot of the fragment, not a link. Block id: {id}',
  'f.sfret.hint': 'End of the fragment: control returns to the bot via the “done” branch. Declared outputs are copied automatically; here you can set an explicit expression for an output.',
  'f.sfret.output': 'Output {name} — expression',

  'ctx.toSubflow': 'Create subflow from selection',
  'ctx.explodeSubflow': 'Explode subflow',
  'ctx.openSubflow': 'Open fragment',

  'sf.backToBot': '← bot',
  'sf.save': 'Save revision',
  'sf.check': 'Check fragment',
  'sf.saved': 'Fragment saved, revision {rev}',
  'sf.notFound': 'Fragment not found in the library',
  'sf.loadError': 'Failed to load the fragment',
  'sf.extracted': 'Subflow “{name}” created — the canvas now has a call block',
  'sf.exploded': 'Call exploded into plain blocks',
  'sf.extractEmpty': 'The selection has no blocks for the fragment (the entry point is not moved)',
  'sf.callUpdated': 'Call pinned to revision {rev}',
  'sf.staleBanner': 'Outdated subflow calls: {n}. Update explicitly — live bots run their own snapshots.',
  'sf.updateAll': 'update all',
  'sf.updateOne': 'update to rev {rev}',
  'sf.defaultName': 'New subflow',
  'sf.badge.outdated': 'outdated',
  'sf.badge.missing': 'missing',
  'sf.badge.cycle': 'cycle',

  'sf.extract.title': 'Create subflow from selection',
  'sf.extract.hint': 'Blocks selected: {n}. They will move into a library fragment, and the canvas keeps a single call block with “done” / “failed” branches. Undo with Ctrl+Z.',
  'sf.extract.name': 'Fragment name',
  'sf.extract.inputs': 'Inputs (variables the fragment reads from the bot)',
  'sf.extract.outputs': 'Outputs (variables the fragment gives back to the bot)',
  'sf.extract.ioEmpty': 'none found — add bindings later in the call block inspector',
  'sf.extract.confirm': 'Create subflow',

  'sf.preview.empty': 'The fragment sent nothing. Check that it has messages connected to the “Return” block.',
  'sf.checkSaveFailed': 'Save failed — the check was stopped: the server would run the stale revision instead of the current canvas.',
};
