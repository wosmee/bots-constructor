// EN-фрагмент словаря: гайд, поиск, глоссарий (Промпт 2).
// Тип обязан повторять RU-фрагмент: Record<keyof typeof GUIDE_RU, string> —
// расхождение RU/EN не компилируется.
import { GUIDE_RU } from './i18n.frag.guide';

export const GUIDE_EN: Record<keyof typeof GUIDE_RU, string> = {
  'guide.recipe.payments.title': 'Your own payment provider: sell access via a link',
  'guide.recipe.payments.s0': 'Open the bot’s “Payments” page and connect your provider (YooKassa, Robokassa, Stripe, or a custom one).',
  'guide.recipe.payments.s1': 'Add a “Payment link” block: pick the connection, set the amount and the order description.',
  'guide.recipe.payments.s2': 'On the “created” branch send the user a message with the {{pay.link}} link or a URL button.',
  'guide.recipe.payments.s3': 'A “Payment check” block splits the flow: “paid” — grant access, “awaiting payment” — remind later.',

  // ------------------------------------------------------------ guide search
  'guide.search.placeholder': 'Search the guide…',
  'guide.search.hint': 'Search by block name, term, or topic — it works across all tabs',
  'guide.search.aria': 'Search the guide',
  'guide.search.results': 'Search results',
  'guide.search.empty': 'Nothing found. Try a block name (“Message”), a term (“webhook”), or a topic (“payment”).',
  'guide.showAll': 'Show everything',
  'guide.toc.title': 'On this tab',

  // ---------------------------------------------------------------- recipes
  'guide.recipe.channel.title': 'Required channel subscription',
  'guide.recipe.channel.s0': 'Start → “Channel check” block: set the channel id or @username and add the bot as a channel admin.',
  'guide.recipe.channel.s1': 'The “member” branch grants the material or access; “not a member” sends the channel invite link.',
  'guide.recipe.channel.s2': 'After the link, add an “I subscribed” button and another “Channel check”.',
  'guide.recipe.channel.s3': 'The “error” branch means the bot is not a channel admin — without it Telegram won’t report membership.',

  'guide.recipe.remind.title': 'Remind the user when they go quiet',
  'guide.recipe.remind.s0': 'After a question, add a “Wait for reply” block and set the time in seconds (e.g. 600 — ten minutes).',
  'guide.recipe.remind.s1': 'The “replied” branch is the normal flow continuation.',
  'guide.recipe.remind.s2': 'The “timeout” branch sends a reminder and returns the user to the menu with a “Jump” block.',

  'guide.recipe.foreach.title': 'Send a table row by row',
  'guide.recipe.foreach.s0': 'Look up records with a “Data” block (find operation) — the list lands in a variable, e.g. {{orders}}.',
  'guide.recipe.foreach.s1': '“Loop over list” block: list — {{orders}}, item — {{item}}; the “each item” branch leads to a message.',
  'guide.recipe.foreach.s2': 'Use the record fields in the message, then draw an arrow back into the foreach — that advances the loop to the next item.',
  'guide.recipe.foreach.s3': 'The “list finished” branch is what happens after the last row (e.g. a summary message).',

  'guide.recipe.segment.title': 'Broadcast to a segment only',
  'guide.recipe.segment.s0': 'Tag your audience: a “Tag” block — e.g. “bought” after a successful payment.',
  'guide.recipe.segment.s1': '“Segment broadcast” block: set the tag and the text — messages go into a queue, not all at once.',
  'guide.recipe.segment.s2': 'Branches: “queued” — the broadcast started, “empty” — nobody matched.',

  'guide.recipe.editmsg.title': 'Replace a message instead of sending a new one',
  'guide.recipe.editmsg.s0': 'In a block with buttons enable edit mode (updateMode “edit”): the reply edits the message in place instead of adding a new one.',
  'guide.recipe.editmsg.s1': 'Fill in “Toast” — a short popup over the chat as feedback for the button press.',
  'guide.recipe.editmsg.s2': 'This way a menu updates in place and the chat isn’t cluttered with identical messages.',

  'guide.recipe.markup.title': 'Text formatting: bold, italic, links',
  'guide.recipe.markup.s0': 'In a text block pick the markup mode (parseMode): HTML or MarkdownV2.',
  'guide.recipe.markup.s1': 'Bold and italic in HTML: <b>bold</b>, <i>italic</i>, <b><i>bold italic</i></b>. Tags nest inside each other.',
  'guide.recipe.markup.s2': 'Underline and strikethrough: <u>underlined</u>, <s>struck out</s>. Monospace: <code>code</code>, <pre>code block</pre>.',
  'guide.recipe.markup.s3': 'Links and spoiler: <a href="https://…">link text</a>, <tg-spoiler>hidden text</tg-spoiler>.',
  'guide.recipe.markup.s4': 'The same in MarkdownV2: *bold*, _italic_, _*bold italic*_, [text](https://…), ||spoiler||, `code`.',
  'guide.recipe.markup.s5': 'In MarkdownV2 escape the characters _ * [ ] ( ) ~ ` > # + - = | { } . ! outside formatting with a backslash, or Telegram rejects the message.',
  'guide.recipe.markup.s6': 'Values of {{variables}} are escaped for the chosen mode automatically — user text cannot break the markup.',
  'guide.recipe.markup.s7': 'Unbalanced tags show up as a validator warning before publish.',

  'guide.recipe.inputkinds.title': 'Accept documents and voice messages from users',
  'guide.recipe.inputkinds.s0': 'In the “Input” block pick the content type: document, photo, video, voice, audio, location, or “any”.',
  'guide.recipe.inputkinds.s1': 'The reply lands in the variable as a file_id — forward or store it; {{var_file_name}} and {{var_mime_type}} are available too.',
  'guide.recipe.inputkinds.s2': 'For a location the variable holds a “latitude,longitude” string.',

  // ------------------------------------------------- subflows (fragment library)
  'guide.recipe.subflow.extract.title': 'Move a repeated chunk into a subflow',
  'guide.recipe.subflow.extract.s0': 'Select on the canvas the blocks you copy from scenario to scenario (e.g. “send the menu”).',
  'guide.recipe.subflow.extract.s1': 'Choose “Create subflow from selection” and name the fragment.',
  'guide.recipe.subflow.extract.s2': 'Check the inputs and outputs in the dialog: the platform suggests the variables the selection reads from outside and writes for the outer scenario.',
  'guide.recipe.subflow.extract.s3': 'In place of the selection a “Subflow” block appears with “done” and “failed” branches — wire them the way you would wire the end of the old chunk.',

  'guide.recipe.subflow.update.title': 'Update a subflow in the bot after edits',
  'guide.recipe.subflow.update.s0': 'Edit the fragment in the library — its revision increases and call sites get an “outdated” badge.',
  'guide.recipe.subflow.update.s1': 'Open the call block and press “update to revision N” — the call pins to the fresh snapshot.',
  'guide.recipe.subflow.update.s2': 'Publish the bot: the live scenario changes only after publishing.',

  'guide.recipe.subflow.foreign.title': 'Why you can’t call someone else’s subflow',
  'guide.recipe.subflow.foreign.s0': 'The fragment library is personal: a bot can reference only subflows of its own account.',
  'guide.recipe.subflow.foreign.s1': 'Calling a foreign fragment is a validation error (subflow-missing): at expansion the reference isn’t found in your library.',
  'guide.recipe.subflow.foreign.s2': 'Want the same chunk for yourself — build it again in your own library and call yours.',

  'guide.recipe.subflow.deleted.title': 'What to do when a subflow was deleted',
  'guide.recipe.subflow.deleted.s0': 'The validator reports a subflow-missing error with the id of the call block referencing the deleted fragment.',
  'guide.recipe.subflow.deleted.s1': 'Replace the call with plain blocks — “unpack” the chunk by hand on the canvas.',
  'guide.recipe.subflow.deleted.s2': 'Or restore the fragment from the revision history in the library — the call finds its reference again.',

  // --------------------------------------------------------- block set 2026-10
  'guide.recipe.deadline.title': 'Hold a slot until payment with a deadline',
  'guide.recipe.deadline.s0': 'After the booking, add a “Deadline” block: set the deadline as a date-time or a variable (e.g. 30 minutes from the booking), and the cancel variable — paid.',
  'guide.recipe.deadline.s1': 'Payment sets paid before the deadline (with a “Variable” block or the provider’s webhook) — the deadline cancels into the “in time” branch; confirm the booking there.',
  'guide.recipe.deadline.s2': 'The “expired” branch fires by the clock even if the user is silent: return the slot to sale and send the text from the “Text on expiry” field.',
  'guide.recipe.deadline.s3': 'Connect both branches: without “in time” a payment won’t cancel the deadline, without “expired” an unpaid booking hangs forever.',

  'guide.recipe.geo.title': 'Booking at the nearest branch by geolocation',
  'guide.recipe.geo.s0': 'In the booking flow add a “Location” block: set the request text and the button label — “Share location”.',
  'guide.recipe.geo.s1': 'The “sent location” branch: coordinates are in {{user.lat}} and {{user.lon}} — a “Condition” block on them picks the nearest branch office.',
  'guide.recipe.geo.s2': 'The “declined” branch is mandatory: show the address list and offer to pick a branch by hand with buttons.',
  'guide.recipe.geo.s3': '{{user.lat}}/{{user.lon}} stay available later in the flow: pass them to the manager’s message or into a record with a “Data” block.',

  'guide.recipe.classify.title': 'Sorting incoming messages by labels',
  'guide.recipe.classify.s0': 'Put an “AI classifier” block on incoming messages and list the labels: lead, question, spam — each becomes its own branch.',
  'guide.recipe.classify.s1': 'In the “Classification context” field briefly describe what counts as a lead and what as a question: the context drives classification accuracy.',
  'guide.recipe.classify.s2': 'The fallback label other catches unparsed answers: wire it to the question branch or an operator — such messages must not be lost.',
  'guide.recipe.classify.s3': 'The chosen label lands in {{ai.label}}: use it to set tags, and send leads straight to payment or booking.',

  'guide.recipe.webhook.title': 'The bot reacts to an external system’s event',
  'guide.recipe.webhook.s0': 'Add an “Incoming webhook” block: when the scenario is published it creates its own URL — give that URL to the external system (CRM, form, provider).',
  'guide.recipe.webhook.s1': 'List the body fields in “Webhook body fields” (name, stage): each lands in {{wh.name}} and {{wh.stage}}; left empty — the whole body ends up in {{wh.body}}.',
  'guide.recipe.webhook.s2': 'Draw the launch flow from the block: a message to the client, a “Data” record or a jump into the needed scenario — every event starts processing from it.',
  'guide.recipe.webhook.s3': 'Test the wiring with a POST request to the webhook URL with a JSON body: the bot should walk the launch flow and substitute {{wh.*}} into the text.',

  'guide.recipe.lang.title': 'One bot — several languages',
  'guide.recipe.lang.s0': 'Put a “User language” block at the start of the scenario and list the branch codes: ru, en — each code becomes its own branch.',
  'guide.recipe.lang.s1': 'Lead the branches into their own welcome chains: texts and buttons of each language are separate blocks, not a translation of one message.',
  'guide.recipe.lang.s2': 'The “others” branch catches unlisted client languages: send it the English variant or a neutral menu.',
  'guide.recipe.lang.s3': 'The client’s language code is in {{user.lang}}: use it in manager notifications and to pick the broadcast language.',

  // -------------------------------------------------------------------- FAQ
  'guide.faq.paysecrets.q': 'Are my payment secrets safe?',
  'guide.faq.paysecrets.a': 'Provider keys are encrypted (AES-256-GCM) when saved and never returned — after saving, the panel only shows a mask. Every webhook’s signature is verified before anything is written to the database, and events older than five minutes are rejected: a payment can’t be forged with someone else’s event.',

  'guide.faq.callback.q': 'Why didn’t the button work the second time?',
  'guide.faq.callback.a': 'An inline button press is a separate event (callback query), and Telegram expects exactly one answer to it (answerCallbackQuery) — the platform replies automatically (toast or alert). If the message is edited in place (updateMode “edit”), the old buttons are replaced — pressing the old one does nothing. Check that the button’s branch has a transition configured.',

  'guide.faq.idempotency.q': 'What is idempotency and why do payments need it?',
  'guide.faq.idempotency.a': 'Providers like to repeat webhooks: the same payment event can arrive two or three times. The platform processes an order exactly once: a repeat is accepted with 200 but doesn’t grant access twice or write duplicates. That’s idempotency — the outcome doesn’t depend on the number of repeats.',

  'guide.faq.foreach.q': 'Why doesn’t my loop run?',
  'guide.faq.foreach.a': 'The “each item” branch must lead with an arrow back into the same foreach block — that moves the loop to the next item. If the connection goes elsewhere and never returns, the loop stalls after the first iteration. Also check that the list variable isn’t empty and that the iteration limit (100 by default) isn’t too small.',

  'guide.faq.condin.q': 'How does the “in list” operator work, and can a value contain a comma?',
  'guide.faq.condin.a':
    'The right side of the “in list” and “not in list” operators is split by comma: “Moscow, spb” is a list of two items. Comparison ignores case and trims spaces. A value that itself contains a comma (e.g. “Smith, John”) can never match — the list breaks into two parts. For such values use the “contains” or “equals” (==) operator instead.',

  'guide.faq.subflowcopy.q': 'Is a subflow a copy or a reference?',
  'guide.faq.subflowcopy.a': 'In the editor a call block is a reference to a library fragment, but at publish time the call expands into a snapshot: the live build contains plain blocks. That’s why editing the library alone doesn’t change a running bot.',

  'guide.faq.subflowlive.q': 'Will the live bot change if I edit the library?',
  'guide.faq.subflowlive.a': 'No. The live bot runs the build written at the last publication: until you update the call block to the fresh revision and publish again, it behaves as before.',

  'guide.faq.subflowpublish.q': 'Why didn’t production change after updating a subflow?',
  'guide.faq.subflowpublish.a': 'Updating a call changes only the draft in the editor. The webhook runs the expanded build recorded at publish time — publish the bot again for edits to reach production.',

  // --------------------------------------------------------------- glossary
  'glossary.group.payments': 'Payment provider',
  'glossary.group.audience': 'Audience',
  'glossary.group.library': 'Fragment library',

  'glossary.chatid': 'chat_id',
  'glossary.chatid.text': 'The unique number of the chat an event came from. In private chats it’s the user’s id — that’s how a person is remembered across sessions.',
  'glossary.chataction': 'chat_action',
  'glossary.chataction.text': 'A Telegram action indicator: “typing…”, “uploading photo…”. Shown before a long operation and doesn’t stop the scenario.',
  'glossary.pollanswer': 'poll_answer',
  'glossary.pollanswer.text': 'A user’s answer in the bot’s poll. For Telegram to send these events, poll_answer is included in allowed_updates at publish time.',
  'glossary.cbtoast': 'callback toast',
  'glossary.cbtoast.text': 'A short popup over the chat in response to an inline button press. Set in the “Toast” field and delivered via answerCallbackQuery.',
  'glossary.editvssend': 'edit vs send',
  'glossary.editvssend.text': 'Two ways to update a dialog: edit changes an already-sent message in place, send adds a new one. Edit is used for menus so the chat stays clean.',
  'glossary.messageid': 'message_id',
  'glossary.messageid.text': 'A message’s number within a chat: used to edit it, delete it, or reply to it.',
  'glossary.checkoutlink': 'checkout link',
  'glossary.checkoutlink.text': 'A link to the provider’s payment page for a specific order. The “Payment link” block puts it into the {{pay.link}} variable.',
  'glossary.providersig': 'provider signature',
  'glossary.providersig.text': 'Webhook forgery protection: the platform verifies the signature of every payment event before writing anything.',
  'glossary.idempotency': 'idempotency',
  'glossary.idempotency.text': 'A repeat of the same event changes nothing: two webhooks about one payment are processed as one, without granting access twice.',
  'glossary.backedge': 'back edge (loop)',
  'glossary.backedge.text': 'An arrow leading back into a loop block (e.g. foreach). It isn’t counted as an infinite loop — that’s how an iteration advances to the next item.',
  'glossary.segment': 'segment',
  'glossary.segment.text': 'A part of the audience chosen by a criterion: tag, payment, activity. A segment broadcast reaches only these people.',
  'glossary.counter': 'counter',
  'glossary.counter.text': 'A named number the bot increments or resets: per user or global. Used for limits, steps, and bonuses.',

  // --- fragment library (subflows) ---
  'glossary.subflow': 'subflow',
  'glossary.subflow.text': 'A reusable scenario fragment from your library: build it once (“send the menu”) and call it from many places.',
  'glossary.revision': 'revision',
  'glossary.revision.text': 'The snapshot number of a fragment in the library: every save of a subflow bumps the revision, while calls stay on their pinned one.',
  'glossary.callsite': 'call site',
  'glossary.callsite.text': 'The “Subflow” block in your scenario: it points at a library fragment and splits into “done” and “failed” branches.',
  'glossary.subflowio': 'input/output',
  'glossary.subflowio.text': 'Declared parameters of a fragment: inputs pass data into the subflow, outputs copy the result back into the calling bot’s variables.',
  'glossary.scope': 'isolated vs shared scope',
  'glossary.scope.text': 'Variable mode of a call: in isolated scope fragment variables are renamed (sf.<alias>.<name>) and don’t clash with the bot’s; in shared scope they live in its namespace.',
  'glossary.expansion': 'expansion (compile)',
  'glossary.expansion.text': 'Replacing a call block with the fragment’s plain blocks at publish time: the live bot runs a flat scenario and knows nothing about subflows.',
  'glossary.danglingref': 'dangling reference',
  'glossary.danglingref.text': 'A call referencing a deleted or foreign fragment: the validator answers with a subflow-missing error and blocks publication.',
  'glossary.subflowcycle': 'subflow cycle',
  'glossary.subflowcycle.text': 'A fragment calls itself directly or through others: expansion stops with a subflow-cycle error because such a call can’t be unfolded.',
  'glossary.drillin': 'drill-in',
  'glossary.drillin.text': 'Double-clicking a call block opens the subflow itself in the editor — edit the fragment without leaving the scenario.',
  'glossary.pinnedrev': 'pinned revision',
  'glossary.pinnedrev.text': 'The fragment snapshot a call is fixed to: until you press “update to revision N”, the bot expands exactly that one.',

  // ================================================================ mini apps
  // Mini apps reference layer (phase C): the “Mini apps” guide tab — articles,
  // FAQ and the glossary group. Keys guide.mini.* and glossary.*mini* below.

  'guide.tab.mini': 'Mini apps',
  'guide.mini.title': 'Mini apps',
  'guide.mini.intro': 'A mini app is a website inside Telegram: pages, a tab bar, forms and the bot’s data. Built in the constructor without code, opened at t.me/<bot>/<slug>.',
  'guide.mini.faq.title': 'Mini app FAQ',

  // --- article: a storefront in 10 minutes (Catalog template) ---
  'guide.mini.catalog.title': 'Build a storefront in 10 minutes',
  'guide.mini.catalog.s0': 'On the bot page press “Create Mini App”: pick the bot, enter a name and a slug (address), and choose the “Catalog” template.',
  'guide.mini.catalog.s1': 'The template already has three pages — “Storefront”, “Product” and “Booking” — plus a bottom tab bar: the card grid, search and filters just need to be bound to data.',
  'guide.mini.catalog.s2': 'On the bot’s “Data” page create a table (e.g. “Products”) with photo, title, price and description columns and fill in the rows.',
  'guide.mini.catalog.s3': 'In the “Card grid” element point at that data table, set the title and price columns, and set the detail page to “Product”: tapping a card opens it and passes the row.',
  'guide.mini.catalog.s4': 'Filters: point the “Search” element at the same table and the columns you need, and “Filter chips” at a column of values (e.g. “category”).',
  'guide.mini.catalog.s5': 'On the product page use {field.title} and {field.description} in texts — the placeholders are filled from the row of the opened card.',
  'guide.mini.catalog.s6': 'Booking form: map the fields to table columns (mapping) and give the form a “write a row” action. Publish the mini app — the storefront lives at t.me/<bot>/<slug>.',

  // --- article: a private admin panel ---
  'guide.mini.admin.title': 'A private admin panel for your team',
  'guide.mini.admin.s0': 'Create a mini app with the “Admin panel” template: it has a “Dashboard” page with stat cards and a “Rows” page with a table and an edit form.',
  'guide.mini.admin.s1': 'The access rule is set at creation: “Telegram ID list” (enumerate staff ids) or “Only with tag” (e.g. admin — and grant it with a “Tag” block).',
  'guide.mini.admin.s2': 'The “Stat” element: “row count” mode counts table records, “sum” adds up a column’s values — that’s how you get “applications today” or “revenue” cards.',
  'guide.mini.admin.s3': 'The “Table” element lists data-table rows with the chosen columns; search and sorting run server-side on the same table.',
  'guide.mini.admin.s4': 'The “Record form” (record_form) finds a row by a field (searchColumn) and edits its columns (editColumns) — saving and deleting a row right from the app.',
  'guide.mini.admin.s5': 'The server only hands data to those who passed the access rule: everyone else sees “Access denied”, even knowing the link.',

  // --- article: connecting a mini app to the bot ---
  'guide.mini.bot.title': 'Connect a mini app to the bot',
  'guide.mini.bot.s0': 'The “Mini App” (web_app) block in a scenario sends a message with an inline button opening t.me/<bot>/<slug> — the block has no branches, the flow continues via next.',
  'guide.mini.bot.s1': 'When publishing the mini app enable “Set the bot’s menu button”: the platform calls setChatMenuButton and the app opens from the button left of the input field.',
  'guide.mini.bot.s2': 'The “trigger scenario” button action: the app sends the bot a synthetic message with your command — the scenario runs it like ordinary text and replies in the chat.',
  'guide.mini.bot.s3': 'start_param: in a link like t.me/<bot>/<slug>?startapp=<page id> Telegram passes it signed inside initData; if the value matches a page id, the app opens on that page.',
  'guide.mini.bot.s4': 'Referrals: hand out links with your own startapp and track invitees through the bot — the “trigger scenario” action passes a command, and the scenario’s referral blocks remember who invited whom.',

  // --- article: publishing and rollback ---
  'guide.mini.publish.title': 'Publishing and rolling back a mini app',
  'guide.mini.publish.s0': 'The editor saves a draft: what’s on the canvas isn’t visible to users yet — the live app runs the published schema.',
  'guide.mini.publish.s1': 'The “Publish” button records the current schema as a new revision; before the first publication t.me/<bot>/<slug> answers “not found”.',
  'guide.mini.publish.s2': 'The revision history is on the mini app card: number and date of every publication.',
  'guide.mini.publish.s3': 'Rollback publishes an old snapshot as a NEW revision — history isn’t rewritten, and you can roll forward again.',
  'guide.mini.publish.s4': 'Publishing a mini app doesn’t touch the bot’s scenario: these are two independent publications.',

  // --- mini app FAQ ---
  'guide.mini.faq.outside.q': 'Why doesn’t the mini app open outside Telegram?',
  'guide.mini.faq.outside.a': 'The signed initData block only exists inside the Telegram WebApp: without it the server hands out neither the schema nor table rows. In a regular browser the page opens but shows the “Access denied” screen. Enter from Telegram: a button in a message, the bot’s menu button, or the t.me/<bot>/<slug> link.',
  'guide.mini.faq.denied.q': 'Why do I see “Access denied”?',
  'guide.mini.faq.denied.a': 'Three causes: you didn’t pass the access rule (no tag or your id isn’t in the list), initData expired (the signature is older than a day — relaunch the app from the bot’s button), or the access rule is of an unknown kind — the server deliberately denies those (fail-safe).',
  'guide.mini.faq.images.q': 'Where do the images go?',
  'guide.mini.faq.images.a': 'Uploads from the constructor land in Filebase storage and are served at /m/img/… with a permanent cache; the bot has a media quota. External links (url) load as-is, and a broken link turns into an emoji placeholder. Images by chat file_id show a placeholder in mini apps for now — use Filebase or an external link.',
  'guide.mini.faq.oneuser.q': 'How do I give access to a single person?',
  'guide.mini.faq.oneuser.a': 'The access rule is chosen when the mini app is created and can’t be changed later. Option “Telegram ID list”: enumerate the numeric ids you need (the id is on “Data” → “Clients”). Option “Only with tag”: grant the person a tag with a “Tag” block in the scenario — access appears immediately, and this way you can admit people one by one without recreating the app.',

  // --- glossary: mini apps ---
  'glossary.group.mini': 'Mini apps',
  'glossary.miniapp': 'mini app',
  'glossary.miniapp.text': 'A web application inside Telegram: opened from a bot, made of pages, a tab bar and elements. Built in the constructor without code, served at t.me/<bot>/<slug>.',
  'glossary.tabbar': 'tab bar',
  'glossary.tabbar.text': 'The mini app’s bottom navigation: up to five tabs, each leading to its page. Switching tabs resets the navigation stack; Telegram’s back button steps back within a tab.',
  'glossary.slug': 'slug (address)',
  'glossary.slug.text': 'The tail of a mini app link t.me/<bot>/<slug>: lowercase letters, digits and hyphens, 3–32 characters. Must be unique within one bot.',
  'glossary.accessrule': 'access rule',
  'glossary.accessrule.text': 'Who can open the mini app: everyone, only users with a tag, or only a list of Telegram IDs. Checked server-side on every request; an unknown rule means access denied.',
  'glossary.initdata': 'initData',
  'glossary.initdata.text': 'A signed block of data Telegram WebApp passes on launch: the user profile, the time and start_param. The server verifies the signature with a key derived from the bot token and rejects initData older than a day.',
  'glossary.datatable': 'data table',
  'glossary.datatable.text': 'A table on the bot’s “Data” page: rows with named columns (products, applications, bookings). Mini app elements — grid, table, stat, form — read and write exactly it.',
  'glossary.elaction': 'element action',
  'glossary.elaction.text': 'What a mini app element does on click: go to a page, open a link, write a table row, trigger the bot’s scenario, close the app, or show/hide another element. The set is closed — no arbitrary code.',
  'glossary.ministartparam': 'start_param (mini app)',
  'glossary.ministartparam.text': 'The launch parameter from a t.me/<bot>/<slug>?startapp=… link: Telegram passes it signed inside initData. If it matches a page id, the mini app opens right on that page.',
  'glossary.minirevision': 'revision (mini app)',
  'glossary.minirevision.text': 'The number of a published schema snapshot: every publication creates a new revision, and a rollback publishes an old snapshot as a new one — history isn’t rewritten.',
  'glossary.visiblewhen': 'visible_when',
  'glossary.visiblewhen.text': 'An element’s visibility condition: left and right are user.id/user.name, tag:<name>, var:<name> or field:<column>, and the operator is the same set as the scenario’s “Condition” block. Without a condition the element is always visible.',
  'glossary.filebase': 'Filebase media',
  'glossary.filebase.text': 'S3-compatible image storage for mini apps: constructor uploads land there and are served at /m/img/… with a permanent cache. Each bot has a media-bytes quota.',
};
