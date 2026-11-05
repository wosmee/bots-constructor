// EN-фрагмент словаря: страница «Оплата» (Промпт 2).
// Тип обязан повторять RU-фрагмент: расхождение RU/EN не компилируется.
import { PAY_RU } from './i18n.frag.pay';

export const PAY_EN: Record<keyof typeof PAY_RU, string> = {
  'nav.payments': 'Payments',

  'payments.title': 'Payments',
  'payments.principle':
    'Platform principle: it does NOT use its own payment account, does NOT proxy money and NEVER sees card data. The owner connects THEIR OWN payment provider — money flows directly between the bot’s customer and the provider. Secrets are accepted once and stored encrypted: they can never be viewed again, only replaced.',
  'payments.loading': 'Loading…',
  'payments.refresh': 'Refresh',

  'payments.empty.title': 'No payment connections yet',
  'payments.empty.text':
    'A connection is the owner’s configured payment provider: the bot takes money through it, while the platform only stores the config and verifies webhook signatures. Add your first connection — then use it in the “Payment link” and “Payment check” blocks.',
  'payments.empty.guide': 'Open the guide recipe',

  'payments.provider.telegram': 'Telegram Payments',
  'payments.provider.yookassa': 'YooKassa',
  'payments.provider.robokassa': 'Robokassa',
  'payments.provider.stripe': 'Stripe',
  'payments.provider.custom': 'Custom provider',

  'payments.enabled': 'enabled',
  'payments.disabled': 'disabled',
  'payments.toggle.on': 'Disable connection',
  'payments.toggle.off': 'Enable connection',
  'payments.webhook.label': 'Webhook URL',
  'payments.webhook.hint': 'Set this address in your provider dashboard — payment confirmations will be sent here.',
  'payments.webhook.cabinetHint':
    'This address goes into your payment provider’s dashboard (Notification URL / Result URL). Old long addresses no longer work — replace them with this one. If the address changes, update it in the dashboard, otherwise payment confirmations will stop arriving.',
  'payments.webhook.telegram':
    'Telegram Payments has no external webhook: the invoice is shown right in the chat (sendInvoice), and Telegram reports the payment in the bot’s updates.',
  'payments.webhook.regenerate': 'Generate a new address',
  'payments.webhook.regenerateConfirm':
    'Generate a new webhook address? The old address stops working immediately: events sent to it will be rejected. You must paste the new address into your payment provider’s dashboard.',
  'payments.webhook.regenerateYes': 'Yes, generate a new one',
  'payments.webhook.rotated': 'Webhook address updated — paste the new address into your provider dashboard',
  'payments.copy': 'Copy webhook URL',
  'payments.copied': 'copied',

  'payments.secrets': 'Secrets',
  'payments.secrets.set': 'set',
  'payments.secrets.notSet': 'not set',
  'payments.replace': 'Replace',
  'payments.replace.hint': 'Enter new values. An empty field keeps the previous secret unchanged.',
  'payments.replace.save': 'Save secrets',

  'payments.check': 'Check connection',
  'payments.checking': 'Checking…',
  'payments.check.okLive': 'Connection verified: the provider accepted the keys (live check).',
  'payments.check.okFormat': 'Field formats are valid. A live check is unavailable for this provider — verify the keys in the provider dashboard.',
  'payments.check.failed': 'Check failed',

  'payments.delete': 'Delete connection',
  'payments.delete.confirm':
    'Delete connection “{title}”? Secrets will be erased; if the webhook was configured at the provider, you will need to set it up again.',
  'payments.delete.yes': 'Yes, delete',
  'payments.deleted': 'Connection deleted',

  'payments.new.open': 'Add connection',
  'payments.new.title': 'New connection',
  'payments.new.provider': 'Provider',
  'payments.new.name': 'Title (for yourself, optional)',
  'payments.new.name.placeholder': 'e.g. main checkout',
  'payments.new.submit': 'Add connection',
  'payments.created': 'Connection added',
  'payments.updated': 'Connection updated',
  'payments.save': 'Save',
  'payments.cancel': 'Cancel',

  'payments.field.providerToken': 'Provider token',
  'payments.field.secretKey': 'Secret key',
  'payments.field.password1': 'Password1',
  'payments.field.password2': 'Password2',
  'payments.field.webhookSecret': 'Webhook signing secret',
  'payments.field.shopId': 'Shop ID (shopId)',
  'payments.field.merchantLogin': 'MerchantLogin (shop login)',
  'payments.field.linkTemplate': 'Checkout link template',
  'payments.field.linkTemplate.placeholder': 'https://pay.example.com/checkout?order={{order}}&sum={{amount}}',
  'payments.field.successUrl': 'Success return URL',
  'payments.field.failUrl': 'Failure return URL',
  'payments.field.testMode': 'Test mode',

  'payments.help.telegram.providerToken':
    'Where to get it: @BotFather → /mybots → your bot → Bot Settings → Payments. Choose a payment provider and copy the issued provider token.',
  'payments.help.yookassa.shopId': 'Where to get it: YooKassa dashboard → Profile — the shop identifier (shopId).',
  'payments.help.yookassa.linkTemplate':
    'Required: a YooKassa API-checkout link — without it payments are not recorded. Create a payment page via the YooKassa API (/v3/payments with webhooks) and set its template with the {{order}} and {{amount}} placeholders. A yoomoney.ru/quickpay link does not work — no webhook comes from it.',
  'payments.help.yookassa.secretKey':
    'Where to get it: YooKassa dashboard → Integrations → HTTP notifications: set the connection’s webhook URL there (it appears after adding) and issue a secret key.',
  'payments.help.robokassa.shopId': 'Where to get it: Robokassa dashboard → Settings → Technical settings — the shop login (MerchantLogin).',
  'payments.help.robokassa.password1':
    'Where to get it: Robokassa dashboard → Settings → Technical settings. Password1 signs the checkout link.',
  'payments.help.robokassa.password2':
    'Where to get it: same technical settings. The platform uses Password2 to verify the Result URL (webhook) signature.',
  'payments.help.stripe.secretKey':
    'Where to get it: Stripe Dashboard → Developers → API keys — your account’s Secret key.',
  'payments.help.stripe.linkTemplate':
    'Optional: your own checkout link template. The platform substitutes {{order}}, {{amount}}, {{currency}}, {{description}}, {{success}}, {{fail}} into it.',
  'payments.help.stripe.webhookSecret':
    'Where to get it: Stripe Dashboard → Developers → Webhooks: create an endpoint with the connection’s webhook URL (it appears after adding) and copy the Signing secret (whsec_…).',
  'payments.help.custom.linkTemplate':
    'Checkout link template. The platform substitutes {{order}}, {{amount}}, {{currency}}, {{description}}, {{success}}, {{fail}} into it.',
  'payments.help.custom.webhookSecret':
    'Any shared secret. Your server must sign the raw webhook body with HMAC-SHA256 using this secret and send the result in the X-Signature header.',
  'payments.help.successUrl': 'Optional: the page the customer returns to after a successful payment.',
  'payments.help.failUrl': 'Optional: the page the customer returns to on failure or cancellation.',
  'payments.help.testMode': 'Adds IsTest=1 to the checkout link — Robokassa will not charge real money.',
};
