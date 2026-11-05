// Английский словарь интерфейса.
//
// Живёт отдельным файлом, потому что грузится динамически: в главном бандле он
// занимал бы место, хотя нужен только тем, кто переключил язык на EN.
// Пока чанк едет, интерфейс остаётся на русском — см. loadDict() в i18n.ts.
import type { TKey } from './i18n';
import { GUIDE_EN } from './i18n.frag.guide.en';
import { INSP_EN } from './i18n.frag.insp.en';
import { CANVAS_EN } from './i18n.frag.canvas.en';
import { PAY_EN } from './i18n.frag.pay.en';
import { SUBFLOW_EN } from './i18n.frag.subflow.en';
import { ADMIN_EN } from './i18n.frag.admin.en';
import { MINI_EN } from './i18n.frag.mini.en';
import { BLOCKS2610_EN } from './i18n.frag.blocks2610.en';

const en: Record<TKey, string> = {
  'settings.title': 'Settings',
  'settings.subtitle': 'Stored on the server — synced across your devices',
  'settings.theme': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.language': 'Interface language',
  'settings.hints': 'Hints',
  'settings.hints.hint': 'Explanations in the UI and on the canvas',
  'settings.whatif': '“What if”',
  'settings.whatif.hint': 'Prediction while dragging a connection',
  'settings.conflicts': 'Conflict inspector',
  'settings.conflicts.hint': 'Find graph problems and highlight them on the canvas',
  'settings.sleep': 'Sleep mode',
  'settings.sleep.hint': 'Dim everything except the branch being edited',
  'settings.advanced': 'Advanced blocks',
  'settings.advanced.hint': 'The “Advanced” palette group: http, AI, variables and loops in one section',
  'settings.role': 'Role',
  'settings.close': 'Close',
  'settings.saving': 'Saving…',
  'settings.saved': 'Saved',
  'settings.error': 'Could not save',
  'settings.security': 'Security',
  'settings.password.title': 'Change password',
  'settings.password.hint': 'All sessions are closed afterwards — you will have to sign in again on other devices.',
  'settings.password.old': 'current password',
  'settings.password.new': 'new password (at least 6 characters)',
  'settings.password.submit': 'Change password',
  'settings.password.done': 'Password changed, sessions closed: {n}',
  'settings.sessions.title': 'Sessions',
  'settings.logoutAll': 'Sign out everywhere',
  'settings.logoutAll.hint': 'Closes every sign-in to this account, including this one.',
  'settings.logoutAll.done': 'Sessions closed: {n}',
  'settings.logoutAll.confirm': 'Close all sessions of this account? You will have to sign in again.',
  'settings.delete.title': 'Delete account',
  'settings.delete.hint': 'All your bots, scenarios, versions, data and sessions will be permanently deleted.',
  'settings.delete.password': 'Enter your current password',
  'settings.delete.start': 'Delete account',
  'settings.delete.confirmHint': 'This cannot be undone. Confirm account deletion.',
  'settings.delete.confirm': 'Yes, delete account',
  'settings.delete.cancel': 'Cancel',
  'settings.delete.passwordError': 'Incorrect password',
  'issue.input-regex': 'Invalid regular expression',
  'notFound.title': 'Page not found',
  'notFound.hint': 'This page does not exist or has been moved.',
  'notFound.back': 'Back to home',
  'settings.skill': 'Experience level',
  'settings.skill.hint': 'Controls how dense the UI is and how much help you get',
  'settings.paletteMode': 'Block group expansion',
  'settings.paletteMode.hint': 'How the palette sections on the left behave',
  'settings.paletteMode.accordion': 'One at a time',
  'settings.paletteMode.free': 'Any number',

  'skill.title': 'What is your level with programming and building bots?',
  'skill.subtitle': 'It decides how much guidance you see and how detailed the interface is. You can change it later in Settings.',
  'skill.high': 'Advanced',
  'skill.high.desc': 'I write code and understand APIs and webhooks. I want a dense interface and no hand-holding.',
  'skill.medium': 'Intermediate',
  'skill.medium.desc': 'I have followed tutorials and get how blocks work. Hints are welcome.',
  'skill.low': 'Beginner',
  'skill.low.desc': 'I am just starting. I need a step-by-step tour, plain labels and no clutter.',
  'skill.more': 'Advanced tools',

  'tour.title': 'Getting to know the editor',
  'tour.next': 'Next',
  'tour.back': 'Back',
  'tour.skip': 'Skip',
  'tour.finish': 'Start building',
  'tour.step': 'Step {n} of {total}',
  'tour.welcome.title': 'Build a bot out of blocks',
  'tour.welcome.text': 'A quick walkthrough: what lives where and how to make your first working scenario. If you forget a term or a block — the Guides (“?” button on top) have a search across the reference, recipes and FAQ.',
  'tour.step1.title': 'Step 1 — add a greeting',
  'tour.step1.text': 'Find “Message” on the left and click it. The block lands on the canvas with the starter text “Hi, {{name}}!”.',
  'tour.step2.title': 'Step 2 — connect it to Start',
  'tour.step2.text': 'Drag an arrow from the right port of “Start” to the “Message” block. Without it the bot stays silent after /start.',
  'tour.step3.title': 'Step 3 — write your own text',
  'tour.step3.text': 'Click the “Message” block. On the right open the “Text” field and write: “Hi! What is your name?” Below the field are variable chips — click one to insert it.',
  'tour.step4.title': 'Step 4 — ask for the name',
  'tour.step4.text': 'In the palette on the left expand the “Input” group, add the “Input” block and connect Message → Input. In the panel on the right set the variable name and the prompt “What is your name?”.',
  'tour.step5.title': 'Step 5 — test and launch',
  'tour.step5.text': 'Press “Preview” at the top and walk through the scenario as a user. When it answers, press “Publish” and send /start to your bot in Telegram.',
  'tour.reopen': 'Show the tour',

  'nav.settings': 'Settings',
  'nav.catalog': 'Template catalog',
  'nav.back': '← bots',
  'nav.backIcon': '←',
  'nav.toBots': 'Back to bots',
  'nav.toEditor': 'back to editor',
  'support.open': 'Support',
  'support.title': 'Support',
  'support.back': '← back',
  'support.new': 'New request',
  'support.submit': 'Send',
  'support.subject': 'Subject',
  'support.body': 'Describe the problem or question',
  'support.reply': 'Reply',
  'support.reply.placeholder': 'Your reply',
  'support.empty': 'No requests yet',
  'support.select': 'Select a request',
  'support.search': 'Search requests',
  'support.staff.open': 'Requests',
  'support.staff.title': 'Support desk',
  'support.assign': 'Take ownership',
  'support.close': 'Close',
  'support.reopen': 'Reopen',
  'support.filter.all': 'All',
  'support.filter.any': 'Any assignment',
  'support.filter.mine': 'Mine only',
  'support.filter.unassigned': 'Unassigned',
  'support.kind.bug': 'Bug',
  'support.kind.question': 'Question',
  'support.kind.idea': 'Idea',
  'support.kind.billing': 'Billing and access',
  'support.kind.abuse': 'Abuse report',
  'support.kind.other': 'Other',
  'support.status.new': 'New',
  'support.status.in_progress': 'In progress',
  'support.status.closed': 'Closed',
  'support.number': 'Ticket number',

  'app.brand': 'Bot Constructor',
  'auth.tab.login': 'Sign in',
  'auth.tab.register': 'Sign up',
  'auth.tab.admin': 'Admin',
  'auth.admin.title': 'Platform admin sign-in',
  'auth.admin.hint': 'The admin key is kept in this tab only (sessionStorage) and is never bundled. The key is verified by the server before the dashboard opens.',
  'auth.admin.placeholder': 'admin key (from wrangler secret ADMIN_KEY)',
  'auth.admin.enter': 'Sign in',
  'auth.login.title': 'Sign in',
  'auth.register.title': 'Create an account',
  'auth.login.hint': 'Sign in — your bots stay visible only to you.',
  'auth.register.hint': 'Login: 3–32 characters, latin letters, digits, dot, underscore, hyphen. Password — at least 6 characters.',
  'auth.login.placeholder': 'login',
  'auth.password.placeholder': 'password',
  'auth.submit.login': 'Sign in',
  'auth.submit.register': 'Create account',
  'auth.busy': '…',
  'auth.error.loginNotFound': 'No account with this login',
  'auth.error.wrongPassword': 'Incorrect password',
  'auth.error.adminKey': 'Incorrect admin key',

  'dash.newBot': 'New bot',
  'dash.newBot.hint': 'The token is encrypted (AES-256-GCM) and stored in D1 — it never reaches the repo.',
  'dash.name.placeholder': 'bot name',
  'dash.token.placeholder': 'BOT_TOKEN (from @BotFather)',
  'dash.platform.label': 'Bot platform',
  'dash.platform.telegram': 'Telegram',
  'dash.platform.vk': 'VK',
  'dash.token.vkPlaceholder': 'VK community access key',
  'dash.token.vkHint': 'Manage → API usage → Access keys. Permissions: messages, photos, documents.',
  'dash.create': 'Create',
  'dash.cancel': 'Cancel',
  'dash.loading': 'Loading…',
  'dash.empty.title': 'No bots yet',
  'dash.empty.text': 'Create your first one — then assemble a scenario by dragging blocks.',
  'dash.status.published': 'published',
  'dash.status.draft': 'draft',
  'dash.owner': 'owner:',
  'dash.owner.admin': 'platform admin',
  'dash.status.webhookError': 'webhook error',
  'dash.webhookUnchecked': 'webhook not checked — press “Refresh statuses”',
  'dash.webhookUnchecked.short': 'webhook not checked',
  'dash.open': 'open →',
  'dash.bots.title': 'My bots',
  'dash.refresh': 'Refresh statuses',
  'dash.refresh.title': 'check the webhook for every bot',
  'dash.createBot': '+ New bot',
  'dash.logout': 'Sign out',
  'dash.logout.title': 'Sign out of this account',
  'dash.settings.title': 'Settings',
  'dash.delete': 'delete',
  'dash.delete.title': 'delete the bot: webhook, scenario, subscribers and logs',
  'dash.delete.confirm': 'Delete bot “{name}”? Its scenario, versions, subscribers and logs are erased for good.',
  'dash.deleting': 'Deleting…',
  'dash.deleted': 'Bot deleted',
  'dash.adminKey.note': 'Signed in with the admin key: the bot list is empty. Users and their bots live on the “Users” page.',
  'dash.adminKey.toAdmin': 'Open the “Users” page',

  'editor.undo': 'undo (Ctrl+Z)',
  'editor.redo': 'redo (Ctrl+Shift+Z)',
  'editor.find': 'Find',
  'editor.find.title': 'search blocks (Ctrl+F)',
  'editor.vars': 'scenario variables',
  'editor.tidy': 'Tidy up',
  'editor.tidy.title': 'lay out blocks by level from the entry point',
  'editor.versions': 'History',
  'editor.versions.title': 'version history and rollback',
  'editor.logs': 'Events',
  'editor.logs.title': 'bot events',
  'editor.guides': '? Guides',
  'editor.guides.title': 'Guides and tips',
  'editor.preview': 'Preview',
  'editor.edit': 'Editor',
  'editor.templates': 'Templates',
  'editor.templates.title': 'Ready-made scenarios',
  'editor.stats': 'Statistics',
  'stats.title': 'Bot statistics',
  'stats.users': 'users',
  'stats.steps': 'scenario steps',
  'stats.versions': 'scenario versions',
  'stats.subscribers': 'subscribers',
  'stats.empty': 'No statistics yet: this bot has not received messages.',
  'stats.error': 'Could not load statistics.',
  'stats.loading': 'Loading statistics…',
  'editor.errors.title': 'Scenario has errors',
  'editor.save': 'Save',
  'editor.publish': 'Publish',
  'error.unauthorized': 'Your session expired — sign in again',
  'error.forbidden': 'You do not have access to this bot',
  'error.botRequired': 'Enter the bot name and token',
  'error.notSaved': 'The scenario has not been saved yet',
  'error.loginTaken': 'This login is already taken',
  'error.rateLimited': 'Too many requests. Try again later',
  'error.network': 'Could not connect. Check your internet and try again',
  'error.timeout': 'The server did not respond in time. Try again',
  'error.server': 'The server is temporarily unavailable. Try again',
  'error.validation': 'Check the data and fix the errors',
  'error.unknown': 'The action failed. Try again',
  'error.app.title': 'The interface failed to render',
  'error.app.text': 'An unexpected error occurred. Reload the page — if the scenario draft was saved in time, it will not be lost.',
  'error.reload': 'Reload',
  'editor.group.edit': 'Editing',
  'editor.group.info': 'Info',
  'editor.group.run': 'Run',

  'save.saving': 'saving…',
  'save.dirty': 'unsaved changes',
  'save.saved': 'saved',
  'save.title': 'changes are saved automatically',
  'status.emptyScenario': 'scenario is empty — add some blocks',
  'status.noScenario': 'no scenario yet — add some blocks',
  'status.saved': 'saved ✔',
  'status.saveError': 'could not save: {msg}',
  'status.versionConflict': 'The scenario was changed in another tab — the save was rejected so the other edits are not overwritten',
  'conflict.reload': 'Load the latest version',
  'conflict.overwrite': 'Save over it',
  'status.copied': 'blocks copied: {n}',
  'status.pasted': 'blocks pasted: {n}',
  'status.template': 'template: {name}',
  'status.tidy': 'blocks laid out by level',
  'status.draftRestored': 'draft restored',
  'status.makeStart': 'block is now the entry point',
  'status.published': 'published ✔',
  'status.rollback': 'rollback done ✔',
  'status.idCopied': 'id copied: {id}',
  'status.duplicatedWithLinks': 'duplicated with links: {n}',
  'node.frozen': 'frozen',

  'palette.dragHint': 'Click to add, drag to place',
  'palette.hint': 'Click to drop a block in the middle of the canvas, or drag it where you want. Right-click a block for the menu. Shift+drag to select several. Delete removes, Ctrl+D duplicates, Ctrl+C/V copies, Ctrl+Z / Ctrl+Shift+Z undo/redo, Ctrl+S saves, Ctrl+F searches.',
  'palette.search.placeholder': 'Find a block…',
  'palette.search.clear': 'clear search',
  'palette.search.empty': 'Nothing found',
  'connect.hint': 'Click a block to connect into it. Escape cancels.',

  'port.then': 'yes',
  'port.else': 'no',
  'port.hit': 'matched',
  'port.miss': 'no match',
  'port.found': 'found',
  'port.notFound': 'not found',
  'port.paid': 'paid',
  'port.cancelled': 'cancelled',
  'port.default': 'otherwise',

  'bar.toggle': 'Show all buttons',
  'bar.more': 'More',
  'bar.more.title': 'Less used actions',
  'settings.barMode': 'Top bar',
  'bar.mode.slide': 'Slides out',
  'bar.mode.always': 'Always visible',
  'bar.mode.hint': 'This setting is stored in this browser, not in your account.',
  'bar.mode.slide.hint': 'The bar slides out when the cursor reaches the top of the window.',
  'bar.mode.always.hint': 'The bar stays expanded all the time.',
  'bar.help': 'Help',
  'bar.help.title': 'Help and learning',

  'insp.example': 'How to use it:',
  'insp.section.content': 'Content',
  'insp.section.behavior': 'Behaviour',
  'insp.section.branching': 'Branches and links',
  'insp.section.data': 'Data',
  'insp.section.advanced': 'Advanced',
  'insp.section.danger': 'Danger zone',
  'chips.title': 'Insert a variable:',
  'chips.origin': 'from “{block}”',
  'chips.empty': 'No variables yet — add an “Input” block and it appears here.',
  'chips.insert': 'Insert {{var}}',
  'insp.footer.makeStart': 'Make it the entry point',
  'insp.footer.disable': 'Turn the block off',
  'insp.footer.enable': 'Turn the block on',
  'insp.footer.delete': 'Delete',
  'insp.help.more': 'What this block is',
  'insp.value.hidden': 'The button value is generated automatically — no need to edit it.',
  'f.buttons.where': 'Where to show the buttons',
  'f.layout.inline.new': 'under the message text',
  'f.layout.reply.new': 'at the bottom, as a keyboard',
  'f.condition.phrase': 'Check',
  'f.condition.varPlaceholder': 'variable, e.g. age',
  'f.condition.valuePlaceholder': 'value',
  'f.condition.help': 'The variable comes from an “Input” block: whatever the user typed lands in it.',
  'f.goto.search': 'Jump to a block',
  'f.goto.search.placeholder': 'start typing a name',
  'f.goto.noTarget': 'No block selected — the jump goes nowhere.',
  'f.start.command.label': 'Command the bot responds to',
  'f.start.command.help': 'The user types {cmd} and the bot follows the scenario.',

  'glossary.title': 'Glossary',
  'glossary.var': 'variable',
  'glossary.var.text': 'A cell holding data: what the user typed or the bot computed. Inserted into text as {{name}}.',
  'glossary.branch': 'branch',
  'glossary.branch.text': 'One of a block’s exits: a button press, or “yes”/“no” for a condition. Each branch leads to its own block.',
  'glossary.scenario': 'scenario',
  'glossary.scenario.text': 'The bot’s whole path: blocks and the arrows between them. Until you publish, the bot keeps running the previous version.',
  'glossary.webhook': 'webhook',
  'glossary.webhook.text': 'The address Telegram uses to deliver user messages to the bot. The “Publish” button sets it.',

  'pro.shortcuts': 'Keyboard shortcuts',
  'pro.shortcuts.save': 'Ctrl+S — save',
  'pro.shortcuts.undo': 'Ctrl+Z — undo, Ctrl+Shift+Z — redo',
  'pro.shortcuts.find': 'Ctrl+F — search blocks',
  'pro.shortcuts.copy': 'Ctrl+C / Ctrl+V — copy and paste',
  'pro.shortcuts.dup': 'Ctrl+D — duplicate',
  'pro.shortcuts.del': 'Delete — remove selection',
  'pro.advanced': 'Advanced',
  'pro.blockId': 'block id',
  'pro.rawParams': 'Block parameters',
  'pro.copyId': 'Copy id',
  'ctx.copyId': 'Copy id',
  'ctx.duplicateWithLinks': 'Duplicate with links',
  'ctx.jumpToTarget': 'Jump to target',
  'ctx.disable': 'Turn off',
  'ctx.enable': 'Turn on',
  'empty.title': 'Start your scenario',
  'empty.text1': 'Drag a block from the palette on the left onto the canvas',
  'empty.text2': 'or just click it.',
  'empty.cta': 'Open the beginner guide',
  'empty.beginner.text': 'Start from a ready template — swap in your own texts later',
  'empty.beginner.template': 'Use a ready template',

  'draft.found': 'Found an unsaved copy from {when} ({n} blocks)',
  'draft.restore': 'Restore',
  'draft.drop': 'No thanks',

  'ctx.duplicate': 'Duplicate',
  'ctx.copy': 'Copy',
  'ctx.paste': 'Paste',
  'ctx.makeStart': 'Make entry point',
  'ctx.freeze': 'Freeze',
  'ctx.unfreeze': 'Unfreeze',
  'ctx.clearLinks': 'Remove all links',
  'ctx.delete': 'Delete block',
  'ctx.explain': 'Explain',
  'ctx.frozen': 'Frozen',
  'ctx.count': '{n} pcs.',
  'ctx.duplicateN': 'Duplicate ({n})',
  'ctx.deleteN': 'Delete blocks ({n})',
  'ctx.deleteOne': 'Delete block',

  'explain.title': 'What this branch does',
  'explain.empty': 'This block has no continuation — the branch ends here.',
  'explain.loop': '…and then it loops back.',
  'explain.more': 'and {n} more steps',
  'explain.close': 'Got it',

  'whatif.title': 'Tip',

  'conflict.title': 'Conflicts',
  'conflict.dupTrigger': 'Two triggers for “{value}”',
  'conflict.unreachable': 'Unreachable block',
  'conflict.loop': 'Cyclic path with no exit',
  'conflict.deadEnd': 'No outgoing connection',
  'conflict.hint': 'Click a block to see the problem',
  'conflict.pill': 'Scenario conflicts: {n}',
  'conflict.pill.title': 'Open the conflict list',
  'conflict.list.title': 'Scenario conflicts',
  'conflict.list.empty': 'No conflicts',

  'sleep.on': 'Sleep mode on: only the selected branch is active',
  'sleep.off': 'Sleep mode off',

  'insp.entry': 'entry point',
  'insp.help.what': 'The “{block}” block is one scenario step. Fill in the fields below and connect it to what comes next.',
  'insp.help.mistakes': 'Common mistake:',
  'insp.help.mistakes.text': 'leaving a required field empty or forgetting the outgoing connection.',
  'insp.remove': 'remove',
  'insp.add': '＋ {name}',
  'insp.buttons.hint': 'If you paste a link (http…) into the value field, you get a link button with no transition.',
  'insp.buttons.portHint': 'It leads wherever the arrow from the “{name}” port points',
  'f.message.text': 'Text',
  'f.goto.current': 'Currently leads to:',
  'insp.textPlaceholder': 'Text, {{var}} works',
  'vars.sys.lastInput': 'the user’s last input',
  'vars.sys.refLink': 'personal invite link',
  'vars.sys.refInviter': 'who invited the user',
  'vars.sys.refCount': 'how many people were invited',

  'f.command': 'Command',
  'f.command.placeholder': '/help',
  'f.description': 'Description (for yourself)',
  'f.enterMessage': 'Message on entry (optional)',
  'f.command.hint': 'The block fires when the user sends this command. The main entry point (/start) is the Start block.',

  'f.var': 'Variable',
  'f.kind': 'Type',
  'f.kind.text': 'text',
  'f.kind.number': 'number',
  'f.kind.email': 'email',
  'f.kind.photo': 'photo',
  'f.prompt': 'Prompt',
  'f.regex': 'Validation (regex, optional)',
  'f.regex.placeholder': '^\\+?\\d{10,15}$',
  'f.errorText': 'Error text',
  'f.errorText.placeholder': 'That does not look like a phone number. Try again',
  'f.errorText.kindHint': 'Shown when the answer fails the type check (not a number / not an e-mail).',

  'f.contact.request': 'What to ask for',
  'f.contact.phone': 'phone (button “Share contact”)',
  'f.contact.location': 'location (button “Share location”)',
  'f.contact.varPlaceholder': 'phone',

  'f.layout': 'Layout',
  'f.button': 'Button',
  'f.item': 'Item',
  'f.menu.prompt': 'Menu prompt',
  'f.menu.hint': 'A persistent keyboard: it stays attached to messages until replaced or cleared.',

  'f.op': 'Operator',
  'f.op.eq': 'equals',
  'f.op.neq': 'not equals',
  'f.op.gt': 'greater than',
  'f.op.lt': 'less than',
  'f.op.contains': 'contains',
  'f.value': 'Value',

  'f.switch.casePlaceholder': 'value',
  'f.switch.add': '＋ case',

  'f.keywords': 'Words or phrases (comma separated)',
  'f.keywords.placeholder': 'price, how much, quote',
  'f.match': 'Matching',
  'f.match.contains': 'contains the word',
  'f.match.equals': 'exact match',
  'f.keyword.hint': 'The block waits for free-form user text — handy for live dialogs and AI bots.',

  'f.random.branchPlaceholder': 'branch',
  'f.random.weightPlaceholder': 'weight',
  'f.random.add': '＋ branch',
  'f.random.hint': 'Weight 1 and 1 means 50/50. Weight 3 and 1 gives the first branch 75%.',

  'f.setvar.expr': 'Value or expression',
  'f.setvar.exprPlaceholder': '{{score}} + 1',
  'f.setvar.varPlaceholder': 'score',
  'f.setvar.hint': 'Supported: numbers, + − × ÷, brackets and {{var}} substitution. Anything else is stored as text.',

  'f.referral.var': 'Variable for the link',
  'f.referral.varPlaceholder': 'ref.link',
  'f.referral.hint1': 'The block builds a link like',
  'f.referral.hint2': 'and stores it in this variable. Show it with a message or a button — the reward logic is up to you:',
  'f.referral.hint3': '— who invited them,',
  'f.referral.hint4': '— how many people the user has invited.',

  'f.url': 'URL',
  'f.url.placeholder': 'https://api.example.com/v1/price',
  'f.method': 'Method',
  'f.headers': 'Headers (JSON, optional)',
  'f.headers.placeholder': '{"Authorization":"Bearer ..."}',
  'f.body': 'Body (JSON, optional)',
  'f.body.placeholder': '{"user_id":123}',
  'f.jsonPath': 'Path to the value (dot separated)',
  'f.jsonPath.placeholder': 'data.price',
  'f.outVar': 'Where to store the response',
  'f.outVar.placeholder': 'price',

  'f.ai.prompt': 'Prompt',
  'f.ai.promptPlaceholder': 'Reply to the customer: {{last_input}}',
  'f.ai.system': 'Role / system prompt',
  'f.ai.systemPlaceholder': 'You are a polite support agent for company X',
  'f.ai.model': 'Model (optional)',
  'f.ai.modelPlaceholder': 'platform default',
  'f.ai.var': 'Variable for the answer',
  'f.ai.varPlaceholder': 'ai',
  'f.ai.reply': 'send the answer to the user',

  'f.action.kind': 'Type',
  'f.action.webhook': 'webhook',
  'f.action.notify': 'notify (message the admin)',
  'f.action.delay': 'delay (pause)',
  'f.action.broadcast': 'broadcast (to all subscribers)',
  'f.action.text': 'Text',
  'f.action.seconds': 'Seconds',
  'f.action.broadcastText': 'Broadcast text',
  'f.action.broadcastPlaceholder': 'Hi, {{name}}!',

  'f.media.type': 'Type',
  'f.media.photo': 'photo',
  'f.media.video': 'video',
  'f.media.document': 'document',
  'f.media.url': 'URL (public link)',
  'f.media.fileId': 'file_id (takes priority over URL)',
  'f.media.caption': 'Caption',
  'f.media.captionPlaceholder': '{{var}}',

  'f.mg.add': 'Add item',
  'f.mg.item.type': 'Type',
  'f.mg.item.url': 'URL',
  'f.mg.item.fileId': 'file_id',
  'f.mg.item.caption': 'Caption',
  'f.mg.hint': 'An album must contain 2–10 media (Telegram limit).',

  'f.inv.title': 'Invoice title',
  'f.inv.description': 'Description',
  'f.inv.amount': 'Amount (kopecks for RUB)',
  'f.inv.currency': 'Currency',
  'f.inv.label': 'Item label',
  'f.inv.payload': 'Payload (returned after payment)',
  'f.inv.providerToken': 'provider_token (from BotFather)',
  'f.inv.photoUrl': 'Item photo URL (optional)',
  'f.inv.hint': 'provider_token is required — without it Telegram will reject the invoice.',

  'f.sub.action': 'Action',
  'f.sub.subscribe': 'subscribe the user',
  'f.sub.unsubscribe': 'unsubscribe the user',

  'f.note.placeholder': 'A comment on the canvas',

  'node.subscription': 'subscription: {value}',
  'node.menu': 'menu: {value}',
  'node.aiReply': 'AI → reply',
  'node.aiVar': 'AI → {var}',
  'node.location': 'location',
  'node.phone': 'phone → {var}',
  'node.branches': '{var} → {n} branches',

  'block.start.label': 'Start',
  'block.start.hint': 'Entry point of the scenario. Users land here via /start.',
  'block.message.label': 'Message',
  'block.message.hint': 'Sends text. Supports {{var}} substitution.',
  'block.buttons.label': 'Buttons',
  'block.buttons.hint': 'Shows buttons under a message. Each button leads somewhere of its own.',
  'block.input.label': 'Input',
  'block.input.hint': 'Asks a question and remembers the answer under a name, so you can reuse it in a message.',
  'block.condition.label': 'Condition',
  'block.condition.hint': 'Compares what is already known about the user and picks which of two paths to follow.',
  'block.action.label': 'Action',
  'block.action.hint': 'Does something behind the scenes: notifies you, waits, or broadcasts a message.',
  'block.goto.label': 'Jump',
  'block.goto.hint': 'Sends the user to another block — for example back to the menu.',
  'block.end.label': 'End',
  'block.end.hint': 'Ends the conversation. The next message starts the scenario over.',
  'block.media.label': 'Media',
  'block.media.hint': 'Sends one photo, video or document — by link or already uploaded.',
  'block.subscription.label': 'Subscription',
  'block.subscription.hint': 'Turns broadcast messages on or off for this user.',
  'block.menu.label': 'Menu',
  'block.menu.hint': 'Shows buttons that stay at the bottom of the screen on every later message.',
  'block.command.label': 'Command',
  'block.command.hint': 'A separate way in: the bot reacts when the user types this command.',
  'block.keyword.label': 'Keywords',
  'block.keyword.hint': 'Looks at what the user wrote and routes them by familiar words.',
  'block.setvar.label': 'Variable',
  'block.setvar.hint': 'Remembers a value under a name or does arithmetic, e.g. {{count}} + 1.',
  'block.http.label': 'HTTP request',
  'block.http.hint': 'Pulls data from another service and remembers it, so you can show it to the user.',
  'block.ai.label': 'AI reply',
  'block.ai.hint': 'Asks an AI model for an answer and either sends it to the user or stores it.',
  'block.random.label': 'Random choice',
  'block.random.hint': 'Splits users across several variants at random — handy for comparing texts.',
  'block.switch.label': 'Switch',
  'block.switch.hint': 'Picks one of many paths from a known value — instead of a chain of conditions.',
  'block.contact.label': 'Contact / location',
  'block.contact.hint': 'Asks for a phone number or location with a dedicated button and stores it.',
  'block.note.label': 'Note',
  'block.note.hint': 'A note on the canvas for yourself. The bot never sees it.',
  'block.referral.label': 'Referral',
  'block.referral.hint': 'Prepares a personal invite link for the user ({{ref.link}}).',
  'block.media_group.label': 'Media album',
  'block.media_group.hint': 'Sends several photos in one message — 2 to 10 of them.',
  'block.invoice.label': 'Payment',
  'block.invoice.hint': 'Shows a payment invoice right in Telegram and continues differently: paid or cancelled.',

  'whatif.start': 'A greeting or a menu usually follows Start.',
  'whatif.message': 'Buttons or an input often go here — otherwise the bot just goes quiet.',
  'whatif.buttons': 'Buttons branch out: make sure each one leads somewhere.',
  'whatif.input': 'An answer is usually checked with a condition right after input.',
  'whatif.condition': 'A condition has two branches — “yes” and “no”. Fill both.',
  'whatif.action': 'An action runs silently: add a message so the user sees the result.',
  'whatif.goto': 'A jump often creates a loop — make sure there is a way out.',
  'whatif.end': 'End of scenario: nothing goes further from here.',
  'whatif.media': 'Text or buttons logically follow media.',
  'whatif.subscription': 'Confirm the subscription with a message.',
  'whatif.menu': 'A menu is a fork: every button has its own branch.',
  'whatif.command': 'A command is a second entry point. Do not forget the description for the bot menu.',
  'whatif.keyword': 'Keywords have two branches: “match” and “miss”.',
  'whatif.setvar': 'A variable is usually checked with a condition right after assignment.',
  'whatif.http': 'An external request can fail — error handling is most often forgotten here.',
  'whatif.ai': 'The AI can return an empty answer. Add a condition or a retry.',
  'whatif.random': 'Random choice splits the audience — usually two branches or more.',
  'whatif.switch': 'A switch has a default branch — without it some users get stuck.',
  'whatif.contact': 'The user may never share a contact — plan for that.',
  'whatif.note': 'A note is a canvas comment; it does not take part in the bot.',
  'whatif.referral': 'Usually {{ref.count}} is checked with a condition and a reward is given.',
  'whatif.media_group': 'A description or buttons usually follow an album.',
  'whatif.invoice': 'An invoice waits for payment — fill both branches: "paid" and "cancelled".',

  'palette.messages': 'Messages',
  'palette.input': 'Data input',
  'palette.logic': 'Logic',
  'palette.integrations': 'Integrations',
  'palette.flow': 'Flow',

  'preview.title': 'Bot preview',
  'preview.localBadge': 'local run',
  'preview.serverBadge': 'exact run',
  'preview.serverBadge.title': 'run by the real engine on the server',
  'preview.restart': '⟲ restart',
  'preview.fallback': 'local run',
  'preview.empty': 'empty',
  'preview.done': 'scenario finished',
  'preview.inputPlaceholder': 'enter a value',
  'preview.keywordPlaceholder': 'type a phrase (in the bot this is plain text)',
  'preview.geoPlaceholder': '📍 location',
  'preview.contactPlaceholder': '📱 contact',
  'preview.sendGeo': '📍 share location',
  'preview.sendContact': '📱 share contact',
  'preview.geoSent': '📍 location shared',
  'preview.contactSent': '📱 contact shared',
  'preview.runUnavailable': 'run unavailable',
  'preview.end': '■ end of scenario',
  'preview.startCmd': '▶ started by {cmd}',
  'preview.command': '▶ command {cmd}',
  'preview.media': '[{type}]',
  'preview.action': '[action: {kind}]',
  'preview.subscription': '[subscription: {action}]',
  'preview.http': '[HTTP {method} {url}]',
  'preview.ai': '[AI] (no answer is generated in preview)',
  'preview.noLink': '⚠ no connection further',

  'publish.title': 'Publish',
  'publish.close.title': 'close',
  'publish.published': 'published',
  'publish.draft': 'draft',
  'publish.version': 'version',
  'publish.errors': '{n} errors',
  'publish.noErrors': 'no errors',
  'publish.warnings': '{n} warnings',
  'publish.noWarnings': 'no warnings',
  'publish.blocks': 'blocks: {n}',
  'publish.ok': 'Bot published.',
  'publish.ok.text': 'Send it /start in Telegram — if there is no answer, open “? Guides” → “Publishing”.',
  'publish.intro': 'Publishing saves a scenario version, validates it, sets the webhook and updates the command menu. With errors the bot is not published — the previous version keeps working.',
  'publish.confirm': 'I checked the scenario in preview and understand that publishing changes the live bot.',
  'publish.unpublish': 'Unpublish',
  'publish.fixErrors': 'Fix the errors to enable the button',
  'publish.close': 'Close',
  'publish.publishing': 'Publishing…',
  'publish.error': 'publishing failed',
  'publish.unpublishError': 'could not unpublish',
  'publish.step.save': 'Scenario saved',
  'publish.step.validate': 'Scenario validation',
  'publish.step.webhook': 'Webhook installed',
  'publish.step.commands': 'Command menu',
  'publish.step.activate': 'Bot published',
  'publish.step.db': 'Data deleted',
  'publish.step.unknown': 'Publishing step',

  'logs.title': 'Events',
  'logs.userId': 'user_id (optional)',
  'logs.onlyErrors': 'errors only',
  'logs.refresh': 'Refresh',
  'logs.explanation': 'Events are the bot\'s technical journal: saves, publications, steps and errors appear here.',
  'logs.clear': 'Clear events',
  'logs.clearConfirm': 'Clear all events for this bot? This cannot be undone.',
  'logs.empty': 'No events yet.',
  'logs.loadError': 'could not load events',
  'log.ev.scenarioSaved': 'Scenario saved (version {value})',
  'log.ev.botCreated': 'Bot created',
  'log.ev.delay': 'Delay',
  'log.ev.subscription': 'Subscription',
  'log.ev.http': 'HTTP request',
  'log.ev.send': 'Send',
  'log.ev.invoice': 'Invoice',
  'log.ev.broadcast': 'Broadcast',
  'log.ev.scheduled': 'Scheduled action',
  'log.ev.rollback': 'Rollback completed (version {value})',
  'log.ev.publishOk': 'Bot published',
  'log.ev.publishBlocked': 'Publishing blocked: {value} errors',
  'log.ev.webhook': 'Webhook check failed',
  'log.ev.step': 'Scenario step',
  'log.ev.error': 'Operation error',
  'log.ev.engineResume': 'Flow resumed in background',
  'log.ev.engineGaveup': 'Flow stopped: resume limit reached',
  'log.ev.loopBreak': 'Infinite loop broken',
  'log.ev.chainDeferred': 'Chain deferred to background',
  'log.ev.aiTruncated': 'AI history truncated',
  'log.ev.scanCapped': 'Partial search: too many matches',
  'log.ev.scheduleReg': 'Schedule registered',
  'log.ev.scheduleFired': 'Schedule fired',
  'log.ev.scheduleDisabled': 'Schedule disabled',
  'log.ev.scheduleLimit': 'Schedule limit per bot',

  'vars.title': 'Variables',
  'vars.notDefined': '⚠ Never written anywhere:',
  'vars.empty': 'No variables yet.',
  'vars.written': 'written: ',
  'vars.read': 'read: ',
  'vars.system': 'system',
  'vars.dash': '—',
  'vars.notUsed': 'not used',
  'vars.andMore': ' and {n} more',
  'vars.foot': 'last_input — the latest user input, always available.',

  'search.placeholder': 'search: text, command, variable…',
  'search.close': 'close search',
  'search.empty': 'nothing found',

  'versions.title': 'Version history',
  'versions.loading': 'Loading…',
  'versions.empty': 'No saved versions yet.',
  'versions.current': 'current',
  'versions.published': 'published',
  'versions.rollback': 'Roll back',
  'versions.publish': 'Publish',
  'versions.publishConfirm': 'Publish saved version {v}?',
  'versions.confirm': 'Roll back to version {v}? The current canvas will be replaced.',
  'versions.delete': 'delete',
  'versions.deleteAll': 'delete history',
  'versions.deleteConfirm': 'Delete version v{v}? This cannot be undone.',
  'versions.deleteAllConfirm': 'Delete all history except the current and published versions?',
  'versions.rollbackError': 'rollback failed',
  'versions.loadError': 'could not load history',
  'versions.kb': '{size} KB',

  'tpl.title': 'Ready-made scenarios',
  'tpl.intro': 'A full block scenario will open.',
  'tpl.blocks': '{n} blocks',
  'tpl.tgOnly': 'Telegram-only',
  'tpl.tgOnly.hint': 'This template has blocks that do not work on VK. The validator will highlight them after insertion.',
  'tpl.confirm': 'The canvas already has blocks. Template “{name}” can replace them or be added next to them.',
  'tpl.replace': 'Replace the canvas',
  'tpl.append': 'Add alongside',
  'tpl.open': 'Open template',
  'tpl.select': 'Select',
  'tpl.selected': 'Selected',
  'tpl.apply': 'Apply template',
  'tpl.empty.title': 'Start with an empty scenario',
  'tpl.empty.text': 'Build the path yourself: Start → Message → Input or Buttons → End.',
  'tpl.empty.action': 'Start empty',

  'catalog.title': 'Template catalog',
  'catalog.subtitle': 'Shared gallery: scenarios published by users',
  'catalog.search': 'Search by title, description or tag…',
  'catalog.sort.popularity': 'Most popular',
  'catalog.sort.newest': 'Newest',
  'catalog.empty': 'Nothing here yet. Be the first to publish a scenario.',
  'catalog.notFound': 'No matches',
  'catalog.loading': 'Loading…',
  'catalog.uses': 'uses',
  'catalog.blocks': 'blocks',
  'catalog.by': 'by',
  'catalog.upload': 'Publish my template',
  'catalog.use': 'Use',
  'catalog.delete': 'Delete',
  'catalog.confirmUse': 'The current scenario of “{name}” will be replaced. Continue?',
  'catalog.confirmDelete': 'Delete template “{title}”? This cannot be undone.',
  'catalog.pickBot': 'Which bot should load it?',
  'catalog.needBot': 'Open a bot first to load the template into it',
  'catalog.form.title': 'Title',
  'catalog.form.description': 'Description',
  'catalog.form.tags': 'Tags, comma separated',
  'catalog.form.submit': 'Publish to catalog',
  'catalog.form.cancel': 'Cancel',
  'catalog.loaded': 'Template loaded into the bot',
  'catalog.deleted': 'Template deleted',
  'catalog.all': 'all',

  'common.cancel': 'Cancel',
  'common.error': 'Error',
  'common.retry': 'Retry',

  'common.close': 'Close',
  'common.close.title': 'close',

  'guide.tab.start': 'Quick start',
  'guide.tab.blocks': 'All blocks',
  'guide.tab.recipes': 'Recipes',
  'guide.tab.publish': 'Publishing',
  'guide.tab.faq': 'FAQ',
  'guide.beginner.first': 'What to do first:',
  'guide.beginner.first.text': 'add Start, connect it to Message, fill in the text and check the result in Preview.',
  'guide.beginner.blocks': 'Start with the green Start block and the blue Message block. Add other blocks after the basic chain responds.',

  'guide.start.title': 'Build a bot in 5 minutes',
  'guide.start.s1.b': 'Create a bot.',
  'guide.start.s1.a': 'Go to @BotFather, run',
  'guide.start.s1.c': ', get the token. On the constructor home page press “+ New bot” and paste the name and token.',
  'guide.start.s2.b': 'Place the blocks.',
  'guide.start.s2.a': 'The palette is on the left. Click a block or drag it onto the canvas. Usually',
  'guide.start.s2.c': 'goes first, then',
  'guide.start.s2.d': '.',
  'guide.start.s3.b': 'Connect them.',
  'guide.start.s3.a': 'Drag from the right dot of one block to the left dot of the next. Without a connection the bot stops — in preview you will see “⚠ no connection further”.',
  'guide.start.s4.b': 'Configure a block.',
  'guide.start.s4.a': 'Click a block and its fields open on the right: text, variable, buttons. In text you can write',
  'guide.start.s4.c': '— it will be replaced with what the user entered earlier.',
  'guide.start.s5.b': 'Check the preview.',
  'guide.start.s5.a': 'Press “Preview” at the top and walk the scenario as a user, without touching Telegram.',
  'guide.start.s6.b': 'Save and press “Publish”.',
  'guide.start.s6.a': 'After that the bot is live: send it /start in Telegram.',
  'guide.start.rule.b': 'The main rule:',
  'guide.start.rule': 'every block must have a way out. If nothing follows an arrow, the scenario ends there.',
  'guide.start.examples': 'Three basic scenarios to start with',
  'guide.start.ex1': 'Business card:',
  'guide.start.ex1.t': 'Start → Message → Menu → branches → Jump back to Menu.',
  'guide.start.ex2': 'Lead form:',
  'guide.start.ex2.t': 'Start → Input (name) → Input (phone) → Action notify → Message → End.',
  'guide.start.ex3': 'Quiz:',
  'guide.start.ex3.t': 'Variable score = 0 → questions on Buttons → Variable score = {{score}} + 1 → Condition → result.',
  'guide.start.hotkeys': 'Hotkeys and menu',
  'guide.start.hk1': 'Right-click a block',
  'guide.start.hk1.t': '— menu: duplicate, copy, paste, make entry point, disable, remove links, delete.',
  'guide.start.hk2': 'Delete',
  'guide.start.hk2.t': '— delete the selected block.',
  'guide.start.hk3': 'Ctrl+D',
  'guide.start.hk3.t': '— duplicate the selected block.',

  'guide.blocks.title': 'Block reference',
  'guide.blocks.search': 'search by name or description…',
  'guide.blocks.empty': 'nothing found',

  'guide.recipes.title': 'Ready-made recipes',
  'guide.recipes.intro': 'Take a blueprint and rebuild it from blocks — faster than inventing from scratch.',

  'guide.recipe.0.title': 'Business card bot with a menu',
  'guide.recipe.0.s0': 'Start → Message “Hi! I am the bot of company X”',
  'guide.recipe.0.s1': 'Menu with items: Services / Prices / Contacts (each item gets its own branch)',
  'guide.recipe.0.s2': 'At the end of every branch — a Jump back to the Menu block so the user never hits a dead end',

  'guide.recipe.1.title': 'Lead form with a Telegram notification',
  'guide.recipe.1.s0': 'Input → variable name, prompt “What is your name?”',
  'guide.recipe.1.s1': 'Input → variable phone (or Contact/location if you need the number by button)',
  'guide.recipe.1.s2': 'Action → notify, text “Lead: {{name}}, {{phone}}” — it goes to the admin',
  'guide.recipe.1.s3': 'Message “Thanks, your request is accepted” → End',

  'guide.recipe.2.title': 'Quiz with scoring',
  'guide.recipe.2.s0': 'At the start: Variable score = 0',
  'guide.recipe.2.s1': 'Question: Buttons with options, the correct branch leads to Variable score = {{score}} + 1',
  'guide.recipe.2.s2': 'Repeat for every question, finish with a Message “Your score: {{score}}”',
  'guide.recipe.2.s3': 'Condition: if {{score}} > 3 — one branch, otherwise another',

  'guide.recipe.3.title': 'AI assistant bot',
  'guide.recipe.3.s0': 'Start → Menu: “Ask a question” / “About us”',
  'guide.recipe.3.s1': 'Question branch: Input last_input → AI reply with prompt “Answer the question: {{last_input}}”, enable “send the answer to the user”',
  'guide.recipe.3.s2': 'After the AI — a Jump back to Menu, that makes a dialog',
  'guide.recipe.3.s3': 'Keywords “price, quote” can bypass the AI with a ready answer',

  'guide.recipe.4.title': 'Broadcast to subscribers',
  'guide.recipe.4.s0': 'Somewhere in the scenario put Subscription → subscribe (for example after consent)',
  'guide.recipe.4.s1': 'A separate branch: Action → broadcast with the message text — it reaches everyone subscribed',
  'guide.recipe.4.s2': 'Put Subscription → unsubscribe on a “Turn notifications off” button',

  'guide.recipe.5.title': 'A/B test of a message',
  'guide.recipe.5.s0': 'Random choice: two branches with weights 1 and 1 (or 3 and 7)',
  'guide.recipe.5.s1': 'Each branch has its own message variant',
  'guide.recipe.5.s2': 'Both branches merge back into a common block — easier to compare',

  'guide.publish.title': 'Publishing the bot',
  'guide.publish.intro': 'The “Publish” button walks the scenario step by step and shows what happened at each step. If the validator finds an error, nothing reaches Telegram — the bot stays on the previous version.',
  'guide.publish.s0': 'Saving the scenario — a new version goes to the database, previous ones stay in history.',
  'guide.publish.s1': 'Validating the scenario — the validator looks for errors and warnings. Errors stop publishing, warnings do not.',
  'guide.publish.s2': 'Setting the webhook — Telegram gets the address it will call.',
  'guide.publish.s3': 'Command menu — Start and Command blocks go into the bot’s /-menu.',
  'guide.publish.s4': 'Bot is active — the card in the list is marked “published”.',
  'guide.publish.note.b': 'Good to know:',
  'guide.publish.note': 'publishing does not erase the previous version. Versions pile up in the database and you can roll back to any of them — the “History” button.',
  'guide.publish.checks': 'What the validator checks',
  'guide.publish.checklist': 'Pre-publish checklist',
  'guide.publish.cl0': 'Run the scenario in “Preview” — dead ends and empty messages show up there.',
  'guide.publish.cl1.a': 'Check that every variable you substitute as',
  'guide.publish.cl1.b': 'is written somewhere (Input, Contact, Variable, HTTP, AI).',
  'guide.publish.cl2': 'Make sure the bot token from @BotFather is current — it gets rotated if leaked.',
  'guide.publish.cl3': 'After publishing, send the bot /start in Telegram and walk the whole path.',

  'guide.check.0.q': 'No Start block',
  'guide.check.0.a': 'Add a Start block and make it the entry point (right-click → “Make entry point”).',
  'guide.check.1.q': 'A block leads nowhere',
  'guide.check.1.a': 'Every block needs an exit: an arrow to the next block or the End block. Otherwise the scenario breaks off there.',
  'guide.check.2.q': 'Empty message text',
  'guide.check.2.a': 'Open the block and write the text — Telegram will not send an empty message.',
  'guide.check.3.q': 'A button has no target',
  'guide.check.3.a': 'For every button pick the block it leads to. A link button (value like http…) needs no target.',
  'guide.check.4.q': 'A condition branch has no continuation',
  'guide.check.4.a': 'Fill both branches: “if true” and “otherwise”. An empty branch breaks the scenario.',
  'guide.check.5.q': 'Unreachable block',
  'guide.check.5.a': 'The block cannot be reached from Start or Command — check the arrows. This is a warning, not an error.',
  'guide.check.6.q': 'Infinite loop',
  'guide.check.6.a': 'A loop without Input, Buttons, Keywords or a pause: the bot will send messages non-stop. Insert a waiting block.',

  'guide.faq.title': 'FAQ',
  'guide.faq.0.q': 'The bot does not answer after deployment',
  'guide.faq.0.a': 'Check that you pressed “Publish” (it sets the webhook), that the token from @BotFather is correct, and that a Start block with a connection exists. If the scenario is empty, the bot replies “in development”.',
  'guide.faq.1.q': 'How do I insert the user name into text?',
  'guide.faq.1.a': 'Write {{name}} — the variable is substituted if an Input block with variable name came earlier. It works in any text: messages, prompts, AI prompts.',
  'guide.faq.2.q': 'How do I return to the menu?',
  'guide.faq.2.a': 'A Jump (goto) block targeting “Menu”. Put it at the end of every branch — otherwise the scenario hits End and the session resets.',
  'guide.faq.3.q': 'What is the difference between Buttons and Menu?',
  'guide.faq.3.a': 'Buttons are one-off, attached to a specific message. Menu is a persistent keyboard at the bottom, shown on every message until you replace it.',
  'guide.faq.4.q': 'Why “Freeze” in the right-click menu?',
  'guide.faq.4.a': 'To temporarily take a piece of the scenario out without deleting it and rebuilding links: the bot just walks through the block. Handy for tests.',
  'guide.faq.5.q': 'How does a pause before a message work?',
  'guide.faq.5.a': 'Action → delay, set the seconds. The platform schedules the send and continues the scenario later (the handler ticks once a minute).',
  'guide.faq.6.q': 'Where is user data stored?',
  'guide.faq.6.a': 'In the platform cloud database: sessions, variables, subscribers, logs. The bot token is encrypted and never transferred in the clear.',
  'guide.faq.7.q': 'Can the user type text instead of picking from a menu?',
  'guide.faq.7.a': 'Yes — that is what the Keywords block is for: list phrases separated by commas and free-form user text lands on the right branch.',

  'guide.foot': 'Tip: the guide opens with the “? Guides” button in the top bar of the editor.',
  'guide.skill.title': 'How the experience levels differ',
  'guide.skill.intro': 'The level changes how much help you get and which tools are available — not the looks.',
  'guide.skill.col': 'What you get',
  'guide.skill.low': 'Beginner',
  'guide.skill.low.text': 'A hint and a usage example under every block in the list, a step-by-step “build a bot” tour, clickable terms, and an empty canvas that offers a ready template.',
  'guide.skill.medium': 'Intermediate',
  'guide.skill.medium.text': 'No beginner explanations, but field hints stay on. This is the default middle ground.',
  'guide.skill.high': 'Advanced',
  'guide.skill.high.text': 'A dense collapsible top bar, keyboard shortcuts, block ids and raw parameters in the inspector, validator error codes, fast actions in the block menu.',
  'guide.skill.change': 'You can change the level in Settings at any time. The startup chooser appears only once per account.',
  'guide.ok': 'Got it',

  'nav.data': 'Data',
  'block.data.label': 'Data',
  'block.data.hint': 'Writes, finds, updates and deletes records in this bot’s tables.',
  'block.data.example': 'First create an “Orders” table on the Data tab, then save a request there and look it up by phone number.',
  'whatif.data': 'Fill in the “found” and “not found” branches — otherwise the search changes nothing.',
  'palette.data': 'Data',

  'block.start.example': 'A greeting or a Menu usually follows Start — otherwise the user sees nothing.',
  'block.message.example': 'Write “Hi, {{name}}!” — if an “Input” block with variable name came earlier, the name is substituted.',
  'block.buttons.example': 'Two buttons → two ports. Draw an arrow from each to its own block: “Catalog” and “Help” lead to different places.',
  'block.input.example': 'Ask “What is your name?” — the answer lands in {{name}} and can be reused in any later message.',
  'block.condition.example': 'Check {{age}} > 18: the “yes” branch goes to the catalog, the “no” branch to a refusal.',
  'block.action.example': 'notify sends you the request: “New lead: {{name}}, {{phone}}” arrives in Telegram.',
  'block.goto.example': 'Put a jump back to the “Menu” block at the end of every branch — the user returns to the choice instead of hitting the end.',
  'block.end.example': 'Use End only when the conversation really is over. Afterwards the user has to send /start again.',
  'block.media.example': 'Paste a photo link and a caption like “{{name}}, here is our catalog” — the media arrives with the caption.',
  'block.subscription.example': 'A “Subscribe” button stores the subscription, and “Action → broadcast” later messages everyone subscribed.',
  'block.menu.example': 'A three-item menu stays at the bottom of every message — handy for a service catalog.',
  'block.command.example': 'Let /price answer with the price list and /help with the docs: commands also appear in the bot menu.',
  'block.keyword.example': 'List “price, how much” — any of those phrases sends the bot down the “matched” branch.',
  'block.setvar.example': 'Start with “Variable score = 0”, then the quiz adds points: {{score}} + 1.',
  'block.http.example': 'Request an exchange rate, store it in {{rate}}, then show it as “Today: {{rate}}” in a message.',
  'block.ai.example': 'Prompt “Answer politely: {{last_input}}” with “reply to the user” on — the bot keeps the conversation going.',
  'block.random.example': 'Half the users see variant A, half see B: two branches with weights 1 and 1.',
  'block.switch.example': 'Route users by {{city}} into three cities: each case gets its own port.',
  'block.contact.example': 'Ask for the number with the “Send contact” button — it lands in {{phone}} with no typos.',
  'block.note.example': 'Write yourself “fix the discount here” — only you see the note, the bot ignores it.',
  'block.referral.example': 'Show {{ref.link}} to the user, then use a condition on {{ref.count}} to hand out the reward.',
  'block.media_group.example': 'Two or three photos in one message: an album looks like a gallery, not three separate files.',
  'block.invoice.example': 'Add the provider_token from BotFather: the “paid” branch leads to delivery, “cancelled” goes back to the menu.',

  'f.data.op': 'Action',
  'f.data.op.add': 'Add a record',
  'f.data.op.find': 'Find records',
  'f.data.op.update': 'Update records',
  'f.data.op.remove': 'Delete records',
  'f.data.collection': 'Table',
  'f.data.collection.none': 'no tables yet — create one on the Data tab',
  'f.data.fields': 'What to write',
  'f.data.where': 'Search by fields',
  'f.data.field': 'field',
  'f.data.value': 'value ({{var}} allowed)',
  'f.data.addField': '+ field',
  'f.data.outVar': 'Result variable',
  'f.data.outVar.hint': '{{order.name}} — field of the found record, {{order_count}} — how many found, {{order_json}} — everything as text',
  'f.data.limit': 'How many records',

  'block.tag.label': 'Tag',
  'block.tag.hint': 'Adds, removes or lists a person’s labels: “VIP”, “bought”, “from campaign X”.',
  'block.tag.example': 'Add the “bought” tag after payment, then use a condition on that tag to route these people into a separate branch.',
  'whatif.tag': 'Follow the tag with a condition on it — otherwise the label changes nothing.',
  'f.tag.op': 'Action',
  'f.tag.op.add': 'Add tag',
  'f.tag.op.remove': 'Remove tag',
  'f.tag.op.clear': 'Clear all tags',
  'f.tag.op.list': 'List tags',
  'f.tag.name': 'Tag name',
  'f.tag.namePlaceholder': 'vip, bought, new',
  'f.tag.outVar': 'Result variable',
  'f.tag.outVar.hint': '{{tags}} — tags separated by commas, {{tags_count}} — how many',
  'f.tag.hint': 'Tag names ignore case: “VIP” and “vip” are the same tag.',
  'f.condition.source': 'What to check',
  'f.condition.source.var': 'A variable',
  'f.condition.source.tag': 'A tag',
  'f.condition.tagHelp': 'Checks whether this tag is on the person. Tags are set by the “Tag” block.',
  'node.chain': '{n} messages in a row',

  'block.chain.label': 'Message chain',
  'block.chain.hint': 'Sends several messages in order: text, a captioned photo, a document.',
  'block.chain.example': 'Describe the product in text, then a photo captioned with the price, then a document with the terms — three messages in order.',
  'whatif.chain': 'A chain is usually followed by buttons or the end of the scenario.',
  'f.chain.add': '+ message',
  'f.chain.item.text': 'message text',
  'f.chain.kind.text': 'Text',
  'f.chain.kind.audio': 'Audio',
  'f.chain.kind.document': 'Document',
  'f.chain.hint': 'Every item is a separate message. For several media in one message use “Media album”.',

  'data.title': 'Bot data',
  'data.hint': 'Clients are everyone who has messaged the bot, with their variables. Tables are your own: orders, requests, bookings. No external database needed.',
  'data.tab.clients': 'Clients',
  'data.tab.collections': 'Tables',
  'data.back': 'Back',
  'data.loading': 'Loading…',
  'data.export': 'Export CSV',
  'data.refresh': 'Refresh',
  'data.clients.total': '{n} clients',
  'data.clients.search': 'search: name, @handle, id, variables',
  'data.clients.empty': 'Nobody has messaged the bot yet',
  'data.client.id': 'ID',
  'data.client.name': 'Name',
  'data.client.username': 'Handle',
  'data.client.firstSeen': 'First seen',
  'data.client.lastSeen': 'Last seen',
  'data.client.vars': 'Variables',
  'data.client.vars.empty': 'empty',
  'data.client.edit': 'Edit',
  'data.client.delete': 'Delete',
  'data.client.delete.confirm': 'Delete client {id}? The session, subscriptions and their records in tables will be erased.',
  'data.client.edit.title': 'Variables of client {id}',
  'data.var.add': '+ variable',
  'data.var.name': 'name',
  'data.var.value': 'value',
  'data.save': 'Save',
  'data.cancel': 'Cancel',
  'data.saved': 'Saved',
  'data.deleted': 'Deleted',
  'data.collections.empty': 'No tables yet. Create the first one — for example “Orders”.',
  'data.collection.new': 'New table',
  'data.collection.name': 'Name',
  'data.collection.name.placeholder': 'Orders',
  'data.collection.fields': 'Fields (latin, comma separated)',
  'data.collection.fields.hint': 'name, phone, city — the same names are then inserted as {{order.name}}',
  'data.collection.create': 'Create',
  'data.collection.records': '{n} records',
  'data.collection.delete': 'Delete table',
  'data.collection.delete.confirm': 'Delete table “{name}” together with all its records?',
  'data.items.empty': 'No records',
  'data.items.search': 'search records',
  'data.item.new': 'Add a record',
  'data.item.edit': 'Record',
  'data.item.add': 'Add',
  'data.item.delete': 'Delete',
  'data.item.fromUser': 'client',
  'data.item.date': 'Created',

  // ============================================================ glossary (expanded)
  'glossary.count': '{n} terms',
  'glossary.group.scenario': 'Scenario',
  'glossary.group.telegram': 'Telegram',
  'glossary.group.commerce': 'Payments',
  'glossary.group.referral': 'Referrals',
  'glossary.polling': 'polling',
  'glossary.polling.text': 'A way to receive messages: the bot itself keeps asking Telegram “anything new?”. The platform uses webhooks instead.',
  'glossary.update': 'update (event)',
  'glossary.update.text': 'Any event Telegram sends to the bot: a message, a button press, a payment. One event moves the scenario one step.',
  'glossary.command': 'command',
  'glossary.command.text': 'A message starting with “/”: /start, /help, /price. The Command block reacts to its command from anywhere in the scenario.',
  'glossary.deeplink': 'deep link',
  'glossary.deeplink.text': 'A link that opens the bot and immediately passes it data: t.me/your_bot?start=anything. Referral links work this way.',
  'glossary.startparam': 'start parameter',
  'glossary.startparam.text': 'The text after ?start= in a bot link. The bot receives it in the first message — for example, to learn who invited the person.',
  'glossary.inlinequery': 'inline query',
  'glossary.inlinequery.text': 'A query to the bot straight from any chat’s input field: “@your_bot text”. The result shows as a list above the message.',
  'glossary.callbackquery': 'callback query',
  'glossary.callbackquery.text': 'An inline button press. Telegram sends it to the bot as a separate event; the spinner on the button is removed by answerCallbackQuery.',
  'glossary.sendmessage': 'sendMessage',
  'glossary.sendmessage.text': 'The main Telegram Bot API method: send a text message to a chat. The Message block calls exactly this.',
  'glossary.editmessage': 'editMessage',
  'glossary.editmessage.text': 'Editing an already sent message: text or buttons. Used so a menu updates in place instead of spamming new messages.',
  'glossary.answercallbackquery': 'answerCallbackQuery',
  'glossary.answercallbackquery.text': 'The reply to Telegram for a button press: removes the spinner and can show a toast. The platform calls it automatically.',
  'glossary.setmycommands': 'setMyCommands',
  'glossary.setmycommands.text': 'Registering the bot’s command list — it appears in the Telegram menu. The Publish button does this from your Command blocks.',
  'glossary.getchatmember': 'getChatMember',
  'glossary.getchatmember.text': 'Asking Telegram for a person’s chat status: member, admin, left. Used, for example, to verify a channel subscription.',
  'glossary.chattype': 'chat_type',
  'glossary.chattype.text': 'The chat the event came from: private, group, supergroup, channel. In groups the bot sees less user data.',
  'glossary.scenblock': 'block',
  'glossary.scenblock.text': 'One scenario step: a message, a condition, a request. Blocks are dragged from the palette and joined with arrows.',
  'glossary.edge': 'edge (arrow)',
  'glossary.edge.text': 'The arrow between blocks: the scenario follows it further. On branch points each arrow is labeled with its branch.',
  'glossary.fallback': 'fallback',
  'glossary.fallback.text': 'What the bot does when the main path fails: no match found, request errored. The “no”, “miss”, “error” branches need a continuation.',
  'glossary.snapshot': 'version snapshot',
  'glossary.snapshot.text': 'A copy of the scenario at publish time. In History you can view any snapshot and roll back to it.',
  'glossary.version': 'version',
  'glossary.version.text': 'Each publish creates a new scenario version. The bot runs the published version, not the draft in the editor.',
  'glossary.publish': 'publishing',
  'glossary.publish.text': 'The moment the editor scenario goes live: the platform sets the webhook, registers commands and turns the bot on.',
  'glossary.validation': 'validation',
  'glossary.validation.text': 'Checking the scenario for errors: empty messages, dangling branches, loops without waiting. The red triangle in the topbar is about them.',
  'glossary.dryrun': 'dry run',
  'glossary.dryrun.text': 'Running the scenario without real messages: the editor preview. This is how logic is tested before publishing.',
  'glossary.invoice': 'invoice',
  'glossary.invoice.text': 'A payment inside Telegram: the bot issues an invoice, the user pays by card or Telegram Stars. The Payment block works via sendInvoice.',
  'glossary.sendinvoice': 'sendInvoice',
  'glossary.sendinvoice.text': 'The Telegram method that shows the user a payment card: amount, description, “Pay” button.',
  'glossary.precheckout': 'pre_checkout_query',
  'glossary.precheckout.text': 'Telegram’s last question before charging money: “everything ok?”. The bot must answer within seconds or the payment is cancelled.',
  'glossary.successfulpayment': 'successful payment',
  'glossary.successfulpayment.text': 'The “money charged” event: arrives to the bot right after a successful payment. The scenario follows the “paid” branch.',
  'glossary.providertoken': 'provider token',
  'glossary.providertoken.text': 'The payment provider key (YooKassa, Stripe…) issued by BotFather in the Payments section. Without it an invoice cannot be issued.',
  'glossary.payload': 'payload',
  'glossary.payload.text': 'Your marker inside the payment (e.g. “monthly subscription”). It comes back in the payment event and tells you what was bought.',
  'glossary.referrer': 'referrer',
  'glossary.referrer.text': 'The user who shared a referral link. Bonuses are credited to them.',
  'glossary.referee': 'referee',
  'glossary.referee.text': 'The user who came via someone else’s link. They are attributed to the referrer once — later clicks on other links do not override it.',
  'glossary.reflink': 'referral link',
  'glossary.reflink.text': 'A personal link like t.me/bot?start=ref_123. From its start parameter the bot learns who brought the person.',
  'glossary.attribution': 'attribution',
  'glossary.attribution.text': 'Determining where the user came from: a link, a QR code or an ad. In the Referral link block the ?start= payload handles this.',
  'glossary.antifraud': 'anti-fraud',
  'glossary.antifraud.text': 'Protection against gaming: one bonus per person, no self-invites, cooldown between grants. Configured by the Anti-fraud block.',
  'glossary.multilevel': 'multi-level',
  'glossary.multilevel.text': 'Rewards along the invite chain: the referrer gets a share, their referrer gets a smaller one. Configured in the Hierarchy block.',

  // ============================================================ referral system
  'palette.referral': 'Referral system',

  'port.ref.ok': 'tracked',
  'port.ref.alreadyTracked': 'already tracked',
  'port.ref.selfBlocked': 'self-invite blocked',
  'port.ref.yes': 'yes',
  'port.ref.no': 'no',
  'port.ref.granted': 'granted',
  'port.ref.skipped': 'skipped',
  'port.ref.failed': 'failed',
  'port.ref.joined': 'joined',
  'port.ref.alreadyIn': 'already in',
  'port.ref.notRunning': 'not running',

  'block.referral_track.label': 'Track invite',
  'block.referral_track.hint': 'Records who invited this user. Three branches: tracked, already tracked, self-invite blocked.',
  'block.referral_track.example': 'Put it right after Start: everyone who arrived via a link is attributed to their referrer, the rest follow the normal path.',
  'whatif.referral_track': 'After tracking, people are usually thanked and led into the main funnel.',

  'block.referral_check.label': 'Came via link?',
  'block.referral_check.hint': 'Checks whether the user has a referrer. “Yes” and “no” branches.',
  'block.referral_check.example': 'On “yes” show a personal welcome from the friend, on “no” — the regular intro.',
  'whatif.referral_check': '“Yes” usually leads to a personal welcome, “no” to the common scenario.',

  'block.referral_bonus.label': 'Invite bonus',
  'block.referral_bonus.hint': 'Rewards the referrer when a trigger fires: Nth referral, first payment, subscription or a custom event.',
  'block.referral_bonus.example': 'Trigger “every 5th referral” and reward “message” — the referrer gets a thank-you when the fifth friend joins.',
  'whatif.referral_bonus': 'The “skipped” branch must lead somewhere — most runs go through it.',

  'block.referral_stats.label': 'Invite stats',
  'block.referral_stats.hint': 'Sends the user their numbers: how many invited, whom, how much earned.',
  'block.referral_stats.example': 'Add a “My invites” button wired to this block: {{ref.count}} and {{ref.earnings}} are inserted into the text.',
  'whatif.referral_stats': 'Usually a terminal branch — after the stats people return to the menu.',

  'block.referral_leaderboard.label': 'Referrer leaderboard',
  'block.referral_leaderboard.hint': 'Shows a ranking: sort by invites or revenue, period — all time, month, week or custom.',
  'block.referral_leaderboard.example': 'A monthly top-10 fuels the competition: {{ref.leaderboard}} inserts the ready list into the message.',
  'whatif.referral_leaderboard': 'A leaderboard pairs well with a tournament or a prize for first place.',

  'block.referral_hierarchy.label': 'Multi-level bonus',
  'block.referral_hierarchy.hint': 'Splits an event (e.g. a payment) along the invite chain: per-level shares, depth up to 5.',
  'block.referral_hierarchy.example': 'Depth 2 with 10% / 5% shares: the direct referrer gets 10% of the payment, their referrer — 5%.',
  'whatif.referral_hierarchy': 'Levels only pay for “real” referees — add a verification block before payments.',

  'block.referral_tournament.label': 'Tournament',
  'block.referral_tournament.hint': 'A dated competition: who invites more (or brings more revenue) inside the window. The prize pool splits by places.',
  'block.referral_tournament.example': 'A one-month tournament with a “1000 RUB” pool split 50/30/20: the top three get half, 30% and 20%.',
  'whatif.referral_tournament': 'Outside the window the flow takes “not running” — announce the next tournament there.',

  'block.referral_verification.label': 'Referee verification',
  'block.referral_verification.hint': 'Counts a referee only after a gate: subscription, first payment, payment over an amount, or your own goal variable.',
  'block.referral_verification.example': 'Put it after the referee’s payment: bonuses start accruing only for paying users, not dead souls.',
  'whatif.referral_verification': 'Verification is usually followed by a referrer bonus or the hierarchy.',

  'block.antifraud.label': 'Anti-fraud',
  'block.antifraud.hint': 'Global bonus limits: one per referee, no self-invites, cooldown between grants, minimum account age.',
  'block.antifraud.example': 'One block per scenario is enough: its limits apply automatically to every bonus and tournament grant.',
  'whatif.antifraud': 'This is a declaration of rules — it is not needed in the flow, just place it on the canvas.',

  'node.referral_track': 'who invited whom',
  'node.referral_check': 'has a referrer?',
  'node.referral_stats': 'invite numbers',
  'node.referral_hierarchy': 'shares by level',
  'node.referral_tournament': 'competition',
  'node.antifraud': 'grant limits',

  // inspector: referral fields
  'f.ref.payload': 'Source tag (payload)',
  'f.ref.payloadPlaceholder': 'e.g. vk_ads',
  'f.ref.payload.hint': 'Appended to the link as ?start=ref_<id>_<tag>. Latin letters, digits, - and _ only; the tag shows where people came from.',
  'f.ref.trigger': 'When to grant the bonus',
  'f.ref.trigger.nth_referral': 'Every Nth referral',
  'f.ref.trigger.first_payment': 'Referee’s first payment',
  'f.ref.trigger.subscription_started': 'Subscription started',
  'f.ref.trigger.custom_event': 'Custom event ({{ref.event}})',
  'f.ref.triggerN': 'Which referral number',
  'f.ref.eventName': 'Event name',
  'f.ref.eventName.hint': 'The bonus fires when {{ref.event}} equals this name. The event can be set, for example, from an HTTP response.',
  'f.ref.bonusKind': 'What to grant',
  'f.ref.bonus.send_message': 'Message to the referrer',
  'f.ref.bonus.increment_variable': 'Add to a variable',
  'f.ref.bonus.grant_subscription_days': 'Subscription days',
  'f.ref.bonusText': 'Reward text',
  'f.ref.bonusVar': 'Variable',
  'f.ref.bonusAmount': 'Amount to add',
  'f.ref.bonusDays': 'Subscription days',
  'f.ref.depth': 'Chain depth (1–5)',
  'f.ref.shares': 'Shares per level',
  'f.ref.shares.hint': 'Level 1 is the direct referrer. The shares must sum to at most 1.',
  'f.ref.text': 'Message text',
  'f.ref.text.statsHint': 'Available: {{ref.count}}, {{ref.earnings}}, {{ref.referred}}.',
  'f.ref.text.leaderboardHint': 'Insert {{ref.leaderboard}} — the ready list is substituted.',
  'f.ref.limit': 'Rows to show',
  'f.ref.sort': 'Sort by',
  'f.ref.sort.count': 'invite count',
  'f.ref.sort.revenue': 'revenue',
  'f.ref.sort.activity_period': 'activity in the period',
  'f.ref.period': 'Period',
  'f.ref.period.all_time': 'all time',
  'f.ref.period.month': 'last month',
  'f.ref.period.week': 'last week',
  'f.ref.period.custom': 'custom',
  'f.ref.periodFrom': 'From (YYYY-MM-DD)',
  'f.ref.periodTo': 'To (YYYY-MM-DD)',
  'f.ref.tournamentName': 'Tournament name',
  'f.ref.startsAt': 'Starts at',
  'f.ref.endsAt': 'Ends at',
  'f.ref.metric': 'Metric',
  'f.ref.metric.count': 'invites',
  'f.ref.metric.revenue': 'revenue',
  'f.ref.prizePool': 'Prize pool (description)',
  'f.ref.prizeSplit': 'Prize split, %',
  'f.ref.prizeSplit.hint': 'Shares per place separated by “/”, summing to 100: e.g. 50/30/20.',
  'f.ref.gate': 'How to verify the referee',
  'f.ref.gate.subscribed': 'subscription',
  'f.ref.gate.paid_once': 'any payment',
  'f.ref.gate.paid_min_amount': 'payment over amount',
  'f.ref.gate.custom_goal': 'custom goal (variable)',
  'f.ref.minAmount': 'Minimum amount',
  'f.ref.minAmount.hint': 'In minor currency units: kopecks for RUB.',
  'f.ref.goalVar': 'Goal variable',
  'f.ref.goalVar.hint': 'A boolean scenario variable: 1 or true means “goal reached”.',
  'f.ref.af.onePerUser': 'One bonus per referee',
  'f.ref.af.onePerUser.short': '1 bonus/person',
  'f.ref.af.blockSelf': 'Block self-invites',
  'f.ref.af.blockSelf.short': 'no self-invites',
  'f.ref.af.cooldown': 'Cooldown between bonuses, sec',
  'f.ref.af.cooldown.short': 'cooldown',
  'f.ref.af.minAge': 'Minimum account age, days',
  'f.ref.af.minAge.short': 'age',
  'f.ref.af.hint': 'Limits apply to every bonus and tournament grant of this bot. One block per scenario is enough.',

  'vars.sys.refVerified': 'referee verified (0/1)',
  'vars.sys.refEarnings': 'earned via bonuses',
  'vars.sys.refLeaderboard': 'ready top list',
  'vars.sys.refReferred': 'whom they invited (ids, comma-separated)',
  'vars.sys.refEvent': 'event name for bonuses',

  // --- 2026-09 block set ---
  // TODO(prompt-2): full UI — keys added ahead of time so the dictionaries stay
  // in sync; Inspector field groups come in Prompt 2.

  'port.answered': 'answered', // TODO(prompt-2): full UI
  'port.pollSkipped': 'skipped', // TODO(prompt-2): full UI
  'port.fwdOk': 'forwarded', // TODO(prompt-2): full UI
  'port.fwdFailed': 'failed', // TODO(prompt-2): full UI
  'port.reply': 'replied', // TODO(prompt-2): full UI
  'port.timeout': 'timeout', // TODO(prompt-2): full UI
  'port.member': 'member', // TODO(prompt-2): full UI
  'port.notMember': 'not a member', // TODO(prompt-2): full UI
  'port.error': 'error', // TODO(prompt-2): full UI
  'port.queued': 'queued', // TODO(prompt-2): full UI
  'port.empty': 'empty', // TODO(prompt-2): full UI
  'port.created': 'created', // TODO(prompt-2): full UI
  'port.failed': 'failed', // TODO(prompt-2): full UI
  'port.pending': 'awaiting payment', // TODO(prompt-2): full UI
  'port.each': 'each item', // TODO(prompt-2): full UI
  'port.done': 'list finished', // TODO(prompt-2): full UI
  'port.pass': 'passed', // TODO(prompt-2): full UI
  'port.fail': 'failed', // TODO(prompt-2): full UI
  'port.ok': 'ok', // TODO(prompt-2): full UI
  'port.limitReached': 'limit reached', // TODO(prompt-2): full UI

  'block.poll.label': 'Poll', // TODO(prompt-2): full UI
  'block.poll.hint': 'Sends a Telegram poll or quiz and waits for the answer: “answered” and “skipped” branches.', // TODO(prompt-2): full UI
  'block.poll.example': 'A quiz question with options: the answer lands in {{poll.answer}}, “answered” continues the flow, “skipped” returns to the menu.', // TODO(prompt-2): full UI
  'whatif.poll': 'A poll waits for an answer: connect both branches — “answered” and “skipped”.', // TODO(prompt-2): full UI

  'block.forward.label': 'Forward', // TODO(prompt-2): full UI
  'block.forward.hint': 'Forwards or copies a message to another chat — a channel, an admin, or the user themselves.', // TODO(prompt-2): full UI
  'block.forward.example': 'The user left a review — forward it to the team chat; on the “failed” branch notify an admin.', // TODO(prompt-2): full UI
  'whatif.forward': 'Fill in the “failed” branch — otherwise a forwarding failure passes silently.', // TODO(prompt-2): full UI

  'block.chat_action.label': 'Typing…', // TODO(prompt-2): full UI
  'block.chat_action.hint': 'Shows an activity indicator (“typing…”, “uploading photo…”). Does not block the flow — continues via next.', // TODO(prompt-2): full UI
  'block.chat_action.example': 'Place it before an AI reply: the bot “types” while the answer is generated — feels like a live conversation.', // TODO(prompt-2): full UI
  'whatif.chat_action': 'This block waits for nothing and moves on: put it before a long operation.', // TODO(prompt-2): full UI

  'block.wait.label': 'Wait for reply', // TODO(prompt-2): full UI
  'block.wait.hint': 'Waits for the user’s reply for a given time: “replied” and “timeout” branches.', // TODO(prompt-2): full UI
  'block.wait.example': 'Wait 10 minutes for a reply; on timeout send a reminder — the “timeout” branch.', // TODO(prompt-2): full UI
  'whatif.wait': 'Connect both branches: the user may reply, or may stay silent.', // TODO(prompt-2): full UI

  'block.channel_check.label': 'Channel check', // TODO(prompt-2): full UI
  'block.channel_check.hint': 'Checks membership in a channel or chat: “member”, “not a member” and “error” branches.', // TODO(prompt-2): full UI
  'block.channel_check.example': 'Before handing out a file, check the channel subscription: “not a member” — send an invite link.', // TODO(prompt-2): full UI
  'whatif.channel_check': 'The bot must be an administrator of the channel — otherwise the check always takes “error”.', // TODO(prompt-2): full UI

  'block.segment_broadcast.label': 'Segment broadcast', // TODO(prompt-2): full UI
  'block.segment_broadcast.hint': 'Queues a broadcast to a user segment: by tag and/or selection conditions.', // TODO(prompt-2): full UI
  'block.segment_broadcast.example': 'Tag “bought” plus the text “new arrival” — the broadcast reaches only paying users.', // TODO(prompt-2): full UI
  'whatif.segment_broadcast': 'The broadcast runs asynchronously: the flow continues immediately via “queued”.', // TODO(prompt-2): full UI

  'block.user_stats.label': 'User profile', // TODO(prompt-2): full UI
  'block.user_stats.hint': 'Exposes user data as variables {{user.name}}, {{user.paid_total}} etc. and can send a templated message.', // TODO(prompt-2): full UI
  'block.user_stats.example': 'A “My profile” button: a template with {{user.name}} and {{user.subscription}} shows what the bot knows.', // TODO(prompt-2): full UI
  'whatif.user_stats': 'After this block the user.* variables are available — use them in any text.', // TODO(prompt-2): full UI

  'block.payment_link.label': 'Payment link', // TODO(prompt-2): full UI
  'block.payment_link.hint': 'Creates an order and puts the payment link into {{pay.link}}: “created” and “failed” branches.', // TODO(prompt-2): full UI
  'block.payment_link.example': 'Show the link with a URL button or a message, then verify the payment with the “Payment check” block.', // TODO(prompt-2): full UI
  'whatif.payment_link': 'Send the link to the user via message or URL button, then check the payment.', // TODO(prompt-2): full UI

  'block.payment_check.label': 'Payment check', // TODO(prompt-2): full UI
  'block.payment_check.hint': 'Checks the order status from “Payment link”: “paid”, “awaiting payment” and “failed” branches.', // TODO(prompt-2): full UI
  'block.payment_check.example': 'Grant access on the “paid” branch; on “awaiting payment” remind later.', // TODO(prompt-2): full UI
  'whatif.payment_check': 'Fill in all three branches: paid, still waiting, failed.', // TODO(prompt-2): full UI

  'block.foreach.label': 'Loop over list', // TODO(prompt-2): full UI
  'block.foreach.hint': 'Iterates a list from a variable: each iteration takes the “each item” branch, the end takes “list finished”.', // TODO(prompt-2): full UI
  'block.foreach.example': 'Find records with the “Data” block and send each one as a separate message in the loop.', // TODO(prompt-2): full UI
  'whatif.foreach': 'The loop body must return to this same block — otherwise there is no next iteration.', // TODO(prompt-2): full UI

  'block.random_text.label': 'Random text', // TODO(prompt-2): full UI
  'block.random_text.hint': 'Picks one of the weighted text variants and sends it or stores it in a variable.', // TODO(prompt-2): full UI
  'block.random_text.example': 'Three greetings with weights 1/1/1 — the bot greets differently each time, keeping the dialog alive.', // TODO(prompt-2): full UI
  'whatif.random_text': 'This block has no branches: it simply continues via next.', // TODO(prompt-2): full UI

  'block.assert.label': 'Assertion', // TODO(prompt-2): full UI
  'block.assert.hint': 'Checks a condition and splits the flow: “passed” / “failed”. Sends a message on failure.', // TODO(prompt-2): full UI
  'block.assert.example': 'Before handing out, check {{score}} > 0: if something broke, the bot says so right in the chat.', // TODO(prompt-2): full UI
  'whatif.assert': 'Fill in both branches — “passed” and “failed”.', // TODO(prompt-2): full UI

  'block.counter.label': 'Counter', // TODO(prompt-2): full UI
  'block.counter.hint': 'Increments, decrements or resets a counter — per user or global — and stores the value in a variable.', // TODO(prompt-2): full UI
  'block.counter.example': 'Limit of 3 free requests: each request adds one, the “limit reached” branch offers payment.', // TODO(prompt-2): full UI
  'whatif.counter': 'Set a threshold and fill the “limit reached” branch — that is the whole point of a counter.', // TODO(prompt-2): full UI

  'block.web_app.label': 'Mini App',
  'block.web_app.hint': 'Sends a message with a button that opens a Telegram Web App (Mini App). No branches — the flow continues via next.',
  'block.web_app.example': 'A catalog or a booking flow: the “Open” button launches the Mini App right inside Telegram, while the scenario keeps going.',
  'whatif.web_app': 'This block has no branches: it sends the message and continues via next.',

  'node.web_app.empty': 'Mini App button',

  'f.webapp.text': 'Message text',
  'f.webapp.button': 'Button caption',
  'f.webapp.url': 'Mini App link',
  'f.webapp.urlPlaceholder': 'https://t.me/<bot_username>/<slug>',
  'f.webapp.urlHint': 'Full link https://t.me/<bot_username>/<slug>. A Mini App button only works on a message with an inline keyboard — Telegram does not accept it in a regular reply menu.',

  'block.schedule.label': 'Schedule',
  'block.schedule.hint': 'Registers a schedule: the flow after this block starts on time — daily, on weekdays, on an interval or via a cron expression.',
  'block.schedule.example': 'A 10:00 morning reminder every day: connect a chain of messages after this block and it will be sent on schedule.',
  'whatif.schedule': 'No branches: the scenario after this block is triggered by the schedule, not by the connection.',

  'node.schedule.daily': '{time} daily',
  'node.schedule.weekly': '{time}, {n} d/wk',
  'node.schedule.interval': 'every {n} min',
  'node.schedule.cron': 'cron: {expr}',
  'node.schedule.aud.all': 'everyone',
  'node.schedule.aud.tag': 'tag',
  'node.schedule.aud.single': 'single user',

  'f.sched.kind': 'Schedule type',
  'f.sched.kind.daily': 'Daily',
  'f.sched.kind.weekly': 'By weekdays',
  'f.sched.kind.interval': 'On interval',
  'f.sched.kind.cron': 'Cron expression',
  'f.sched.atTime': 'Time, HH:MM',
  'f.sched.weekdays': 'Weekdays',
  'f.sched.day.1': 'Mon',
  'f.sched.day.2': 'Tue',
  'f.sched.day.3': 'Wed',
  'f.sched.day.4': 'Thu',
  'f.sched.day.5': 'Fri',
  'f.sched.day.6': 'Sat',
  'f.sched.day.7': 'Sun',
  'f.sched.everyMinutes': 'Interval, minutes',
  'f.sched.cronExpr': 'Cron expression (5 fields)',
  'f.sched.cron.hint': '5 fields: minute hour day month weekday. “*”, lists, ranges and steps (“*/5”) are supported.',
  'f.sched.cron.ok': 'Expression is valid',
  'f.sched.cron.bad': 'Expression not recognized: need 5 fields — minute hour day month weekday.',
  'f.sched.audience': 'Who to run for',
  'f.sched.aud.all': 'all subscribers',
  'f.sched.aud.tag': 'by tag',
  'f.sched.aud.single': 'the current user',
  'f.sched.audienceTag': 'Audience tag',
  'f.sched.timezone': 'Timezone',
  'f.sched.limit': 'No more than {max} schedules per bot.',

  'insp.section.aiMemory': 'Conversation memory',
  'f.ai.historyVar': 'History variable',
  'f.ai.historyVarPlaceholder': 'ai_history',
  'f.ai.historyVar.hint': 'Name of the scenario variable that stores the dialog history. Empty — each request goes without previous replies.',
  'f.ai.historyTurns': 'Turns in memory',
  'f.ai.historyTurns.hint': 'How many recent turns to keep. Default 6, maximum {max}.',
  'f.ai.persistHistoryTo': 'Persist history to table',
  'f.ai.persistHistoryTo.hint': 'A table that mirrors the history: there it survives a user session reset.',

  'node.random_text': '{n} variants', // TODO(prompt-2): full UI

  'f.parseMode': 'Text markup', // TODO(prompt-2): full UI
  'f.parseMode.none': 'plain text', // TODO(prompt-2): full UI
  'f.parseMode.HTML': 'HTML', // TODO(prompt-2): full UI
  'f.parseMode.MarkdownV2': 'MarkdownV2', // TODO(prompt-2): full UI
  'f.disablePreview': 'disable link previews', // TODO(prompt-2): full UI

  'f.cb.toast': 'Toast on button press', // TODO(prompt-2): full UI
  'f.cb.alert': 'Alert dialog on button press', // TODO(prompt-2): full UI
  'f.cb.updateMode': 'After a button press', // TODO(prompt-2): full UI
  'f.cb.updateMode.send': 'send a new message', // TODO(prompt-2): full UI
  'f.cb.updateMode.edit': 'edit the current one in place', // TODO(prompt-2): full UI

  'f.deleteUserMessage': 'delete the user’s message', // TODO(prompt-2): full UI
  'f.deleteBotMessage': 'delete the bot’s last message', // TODO(prompt-2): full UI

  'f.kind.document': 'document', // TODO(prompt-2): full UI
  'f.kind.video': 'video', // TODO(prompt-2): full UI
  'f.kind.voice': 'voice', // TODO(prompt-2): full UI
  'f.kind.audio': 'audio', // TODO(prompt-2): full UI
  'f.kind.location': 'location', // TODO(prompt-2): full UI
  'f.kind.any': 'any message', // TODO(prompt-2): full UI

  'f.op.in': 'in list', // TODO(prompt-2): full UI
  'f.op.notIn': 'not in list', // TODO(prompt-2): full UI
  'f.op.startsWith': 'starts with', // TODO(prompt-2): full UI
  'f.op.endsWith': 'ends with', // TODO(prompt-2): full UI
  'f.op.empty': 'is empty', // TODO(prompt-2): full UI
  'f.op.notEmpty': 'is not empty', // TODO(prompt-2): full UI
  'f.op.regex': 'matches regex', // TODO(prompt-2): full UI
  'f.op.gte': 'greater or equal', // TODO(prompt-2): full UI
  'f.op.lte': 'less or equal', // TODO(prompt-2): full UI

  'f.conditions': 'Condition list', // TODO(prompt-2): full UI
  'f.conditions.add': '＋ condition', // TODO(prompt-2): full UI
  'f.conditions.logic': 'How to combine', // TODO(prompt-2): full UI
  'f.conditions.logic.and': 'all (AND)', // TODO(prompt-2): full UI
  'f.conditions.logic.or': 'any (OR)', // TODO(prompt-2): full UI
  'f.condition.source.user': 'User profile field', // TODO(prompt-2): full UI

  'f.http.retries': 'Retries on failure', // TODO(prompt-2): full UI
  'f.http.backoffMs': 'Delay between retries, ms', // TODO(prompt-2): full UI
  'f.http.collectVar': 'Variable for the collected result', // TODO(prompt-2): full UI
  'f.http.paginate': 'Pagination walk', // TODO(prompt-2): full UI
  'f.http.paginate.kind': 'Method', // TODO(prompt-2): full UI
  'f.http.paginate.page': 'page number', // TODO(prompt-2): full UI
  'f.http.paginate.offset': 'offset', // TODO(prompt-2): full UI
  'f.http.paginate.cursor': 'cursor in response', // TODO(prompt-2): full UI
  'f.http.paginate.param': 'Query parameter name', // TODO(prompt-2): full UI
  'f.http.paginate.start': 'Start value', // TODO(prompt-2): full UI
  'f.http.paginate.step': 'Step', // TODO(prompt-2): full UI
  'f.http.paginate.maxPages': 'Max pages', // TODO(prompt-2): full UI
  'f.http.paginate.cursorPath': 'Path to the cursor in the response', // TODO(prompt-2): full UI
  'f.http.paginate.nextCursorPath': 'Path to the next cursor', // TODO(prompt-2): full UI
  'f.http.paginate.delayMs': 'Delay between requests, ms', // TODO(prompt-2): full UI

  'f.poll.question': 'Question', // TODO(prompt-2): full UI
  'f.poll.options': 'Answer options (2–10)', // TODO(prompt-2): full UI
  'f.poll.add': '＋ option', // TODO(prompt-2): full UI
  'f.poll.anonymous': 'anonymous poll', // TODO(prompt-2): full UI
  'f.poll.multiple': 'allow multiple answers', // TODO(prompt-2): full UI
  'f.poll.correct': 'Correct option (quiz)', // TODO(prompt-2): full UI
  'f.poll.correct.none': '— none, a regular poll —', // TODO(prompt-2): full UI
  'f.poll.explanation': 'Explanation for the correct answer', // TODO(prompt-2): full UI

  'f.forward.mode': 'How to forward', // TODO(prompt-2): full UI
  'f.forward.mode.forward': 'forward (author visible)', // TODO(prompt-2): full UI
  'f.forward.mode.copy': 'copy (no author)', // TODO(prompt-2): full UI
  'f.forward.mode.text': 'as own text', // TODO(prompt-2): full UI
  'f.forward.toChatId': 'Destination chat', // TODO(prompt-2): full UI
  'f.forward.toChatIdPlaceholder': '@channel or -100…; empty — the user themselves', // TODO(prompt-2): full UI
  'f.forward.text': 'Message text', // TODO(prompt-2): full UI
  'f.forward.fromVar': 'Variable with the message id', // TODO(prompt-2): full UI

  'f.chatAction': 'Action', // TODO(prompt-2): full UI
  'f.chatAction.typing': 'typing…', // TODO(prompt-2): full UI
  'f.chatAction.upload_photo': 'uploading photo…', // TODO(prompt-2): full UI
  'f.chatAction.upload_document': 'uploading document…', // TODO(prompt-2): full UI
  'f.chatAction.find_location': 'finding location…', // TODO(prompt-2): full UI
  'f.chatAction.record_voice': 'recording voice…', // TODO(prompt-2): full UI

  'f.wait.seconds': 'How long to wait, seconds', // TODO(prompt-2): full UI
  'f.wait.prompt': 'Message before waiting', // TODO(prompt-2): full UI
  'f.wait.reminder': 'Reminder on timeout', // TODO(prompt-2): full UI
  'f.wait.maxMinutes': 'Maximum wait, minutes', // TODO(prompt-2): full UI

  'f.channel.id': 'Channel or chat', // TODO(prompt-2): full UI
  'f.channel.idPlaceholder': '@my_channel or -1001234567890', // TODO(prompt-2): full UI
  'f.channel.requireMembership': 'block the flow without membership', // TODO(prompt-2): full UI
  'f.channel.cacheMinutes': 'Cache the result, minutes', // TODO(prompt-2): full UI

  'f.segment.tag': 'Segment tag', // TODO(prompt-2): full UI
  'f.segment.where': 'Selection conditions', // TODO(prompt-2): full UI
  'f.segment.text': 'Broadcast text', // TODO(prompt-2): full UI
  'f.segment.mediaUrl': 'Media URL (optional)', // TODO(prompt-2): full UI
  'f.segment.chunkSize': 'Users per chunk', // TODO(prompt-2): full UI
  'f.segment.delayMs': 'Delay between chunks, ms', // TODO(prompt-2): full UI
  'f.segment.dailyCap': 'Daily cap', // TODO(prompt-2): full UI

  'f.userstats.prefix': 'Variable prefix', // TODO(prompt-2): full UI
  'f.userstats.template': 'Message template', // TODO(prompt-2): full UI
  'f.userstats.hint': 'Available: {{user.name}}, {{user.username}}, {{user.tags}}, {{user.subscription}}, {{user.paid_total}}, {{user.ref_count}}, {{user.first_seen}}.', // TODO(prompt-2): full UI

  'f.pay.connection': 'Payment connection', // TODO(prompt-2): full UI
  'f.pay.amount': 'Amount (in kopecks for RUB)', // TODO(prompt-2): full UI
  'f.pay.currency': 'Currency', // TODO(prompt-2): full UI
  'f.pay.description': 'Order description', // TODO(prompt-2): full UI
  'f.pay.linkVar': 'Variable for the link', // TODO(prompt-2): full UI
  'f.pay.orderIdVar': 'Variable with the order id', // TODO(prompt-2): full UI
  'f.pay.autoOrderId': 'generate the order id automatically', // TODO(prompt-2): full UI

  'f.foreach.listVar': 'Variable with the list', // TODO(prompt-2): full UI
  'f.foreach.itemVar': 'Item variable', // TODO(prompt-2): full UI
  'f.foreach.indexVar': 'Index variable', // TODO(prompt-2): full UI
  'f.foreach.maxIterations': 'Iteration limit', // TODO(prompt-2): full UI

  'f.rt.variants': 'Text variants', // TODO(prompt-2): full UI
  'f.rt.add': '＋ variant', // TODO(prompt-2): full UI
  'f.rt.weight': 'weight', // TODO(prompt-2): full UI
  'f.rt.send': 'send the picked text to the user', // TODO(prompt-2): full UI
  'f.rt.outVar': 'Variable for the text', // TODO(prompt-2): full UI

  'f.assert.failMessage': 'Failure message', // TODO(prompt-2): full UI

  'f.counter.name': 'Counter name', // TODO(prompt-2): full UI
  'f.counter.scope': 'Counter', // TODO(prompt-2): full UI
  'f.counter.scope.user': 'per user', // TODO(prompt-2): full UI
  'f.counter.scope.bot': 'global (per bot)', // TODO(prompt-2): full UI
  'f.counter.op': 'Operation', // TODO(prompt-2): full UI
  'f.counter.op.inc': 'increment', // TODO(prompt-2): full UI
  'f.counter.op.dec': 'decrement', // TODO(prompt-2): full UI
  'f.counter.op.reset': 'reset', // TODO(prompt-2): full UI
  'f.counter.op.get': 'read value', // TODO(prompt-2): full UI
  'f.counter.amount': 'Step', // TODO(prompt-2): full UI
  'f.counter.max': 'Threshold (limit)', // TODO(prompt-2): full UI
  'f.counter.outVar': 'Variable for the value', // TODO(prompt-2): full UI

  // --- Prompt 2 (2026-09 set UI) ---
  // preview: simulated service inputs (TASK 7)
  'preview.sim.title': 'Simulated service inputs',
  'preview.sim.hint': 'The server-side simulation understands these commands: they switch the channel-membership and payment-status results and imitate attachments. Use them to test new block branches without a live bot.',
  'preview.sim.member': 'channel member',
  'preview.sim.notMember': 'not a member',
  'preview.sim.paid': 'payment succeeded',
  'preview.sim.pending': 'payment pending',
  'preview.sim.failed': 'payment failed',
  'preview.sim.document': 'send document',
  'preview.sim.video': 'send video',
  'preview.sim.voice': 'send voice message',
  'preview.sim.audio': 'send audio',
  'preview.sim.any': 'send sticker (any)',
  'preview.wait.countdown': 'waiting for a reply for another',
  'preview.wait.branches': 'Reply with any text — the flow takes the “replied” branch. Stay silent until the countdown ends — on a live bot the “timeout” branch fires.',
  'preview.menu.title': 'Bot menu (a press arrives as text, just like live)',
  'preview.noButtons': 'Every button on this block is a link: a press opens the site and the bot never learns about it, so the scenario stops here. Same on a live bot.',

  // palette groups
  'palette.content': 'Content',
  'palette.keyboards': 'Buttons & menus',
  'palette.audience': 'Audience',
  'palette.payments': 'Payments',
  'palette.advanced': 'Advanced',
  'palette.advanced.toggle': 'Advanced blocks ({n})',
  'palette.advanced.hint': 'The same http, AI, variables and loop — grouped together for power scenarios.',
  'palette.groupCount': '{n} blocks',
  'palette.groupCount1': '{n} block',
  'palette.groupCount2': '{n} blocks',

  // node summaries
  'node.editMsg': 'edit message',
  'node.deleteMsg': 'delete message',
  'node.conditions': '{n} conditions',
  'node.retries': 'retries: {n}',
  'node.poll': 'poll',
  'node.poll.quiz': 'quiz',
  'node.poll.options': '{n} options',
  'node.forward.forward': 'forward',
  'node.forward.copy': 'copy',
  'node.forward.text': 'as text',
  'node.wait': 'wait {s}s',
  'node.channel_check.empty': 'channel not set',
  'node.segment.tag': 'segment: {tag}',
  'node.segment.empty': 'broadcast text',
  'node.payment': 'payment · {amount} {currency}',
  'node.payment_check': 'status {{{var}}}',
  'node.foreach': 'loop: {{{list}}}',
  'node.assert.empty': 'condition not set',
  'node.counter.limit': 'counter: {name} ≤ {max}',
  'node.counter.inc': '+ {name}',
  'node.counter.dec': '− {name}',
  'node.counter.reset': 'reset: {name}',
  'node.counter.get': 'read: {name}',

  // subflow library
  'subflows.nav': 'Library',
  'subflows.title': 'Subflow library',
  'subflows.hint': 'Fragments of your account: build once — call from any bot with the “Subflow” block.',
  'subflows.hint.canvas': 'To move existing blocks into a fragment, select them on the constructor canvas and choose “Create subflow from selection”.',
  'subflows.search': 'Search by name or description',
  'subflows.search.empty': 'Nothing found — refine the query.',
  'subflows.count': 'Fragments: {n}',
  'subflows.new': 'New fragment',
  'subflows.create.title': 'New subflow',
  'subflows.create.starter': 'Hello from the fragment',
  'subflows.create.submit': 'Create',
  'subflows.create.done': 'Fragment created. Its content is edited on the constructor canvas: add a “Subflow” block and pick this fragment.',
  'subflows.name': 'Name',
  'subflows.name.placeholder': 'e.g. “Send the menu”',
  'subflows.description': 'Description',
  'subflows.description.placeholder': 'what this fragment is for (optional)',
  'subflows.edit': 'Name & description',
  'subflows.edit.title': 'Edit fragment',
  'subflows.save': 'Save',
  'subflows.saved': 'Changes saved',
  'subflows.cancel': 'Cancel',
  'subflows.duplicate': 'Duplicate',
  'subflows.duplicate.done': 'Copy created',
  'subflows.copySuffix': ' (copy)',
  'subflows.delete': 'Delete',
  'subflows.delete.confirm': 'Delete the fragment “{name}”? This cannot be undone.',
  'subflows.delete.warn': 'Bots using the fragment will show a validation error until the call is replaced.',
  'subflows.delete.yes': 'Yes, delete',
  'subflows.deleted': 'Fragment deleted',
  'subflows.rev': 'Revision {n}',
  'subflows.rev.short': 'rev {n}',
  'subflows.usedBy': 'Used by {n} bots',
  'subflows.inputs': 'Inputs',
  'subflows.outputs': 'Outputs',
  'subflows.io.none': 'none',
  'subflows.io.required': 'required',
  'subflows.versions': 'Revisions',
  'subflows.versions.title': 'Revision history',
  'subflows.versions.empty': 'History is empty.',
  'subflows.versions.current': 'current',
  'subflows.restore': 'Restore',
  'subflows.restored': 'Revision {n} restored as a new one',
  'subflows.preview': 'Test run',
  'subflows.preview.title': 'Fragment run',
  'subflows.preview.hint': 'The fragment runs apart from the bot: same engine, a log below instead of a live chat. Sample inputs are substituted into the fragment’s {{variables}}.',
  'subflows.preview.inputs': 'Sample inputs',
  'subflows.preview.run': 'Run',
  'subflows.preview.issues': 'Issues',
  'subflows.preview.logEmpty': 'The run passed with no issues but sent no messages.',
  'subflows.empty.title': 'Nothing here yet',
  'subflows.empty.text': 'A subflow is a named scenario fragment: “send the menu”, “take payment”. Build it once and call it from any bot of your account instead of copying the same blocks. Editing a fragment does not change live bots: the call is updated and published explicitly.',
  'subflows.guideLink': 'Open the guide',

  // --- Prompt 2 fragments (see i18n.frag.*.en.ts) ---
  ...GUIDE_EN,
  ...INSP_EN,
  ...CANVAS_EN,
  ...PAY_EN,
  ...SUBFLOW_EN,
  // --- staff user lookup page ---
  ...ADMIN_EN,
  // --- mini apps (constructor) ---
  ...MINI_EN,
  // --- block set 2026-10 ---
  ...BLOCKS2610_EN,
}

export default en;
