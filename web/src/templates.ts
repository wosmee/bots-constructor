import type { Scenario } from '../../shared/types';

export interface BotTemplate {
  id: string;
  name: string;
  description: string;
  scenario: Scenario;
}

export const TEMPLATES: BotTemplate[] = [
  // 1. Приветственный бот
  {
    id: 'welcome',
    name: 'Приветственный бот',
    description: 'Знакомство с пользователем: спрашивает имя и предлагает выбрать дальнейшее действие.',
    scenario: {
      version: 1,
      start: 'start',
      blocks: {
        start: {
          id: 'start',
          type: 'start',
          params: { command: '/start' },
          next: 'greeting',
        },
        greeting: {
          id: 'greeting',
          type: 'message',
          params: { text: 'Привет! Я помогу вам освоиться. Как вас зовут?' },
          next: 'ask_name',
        },
        ask_name: {
          id: 'ask_name',
          type: 'input',
          params: { var: 'name', kind: 'text', prompt: 'Напишите ваше имя' },
          next: 'welcome_back',
        },
        welcome_back: {
          id: 'welcome_back',
          type: 'message',
          params: { text: 'Приятно, {{name}}!' },
          next: 'menu',
        },
        menu: {
          id: 'menu',
          type: 'buttons',
          params: {
            prompt: 'Что дальше?',
            layout: 'inline',
            buttons: [
              { label: 'Рассказать больше', value: 'more' },
              { label: 'Пока', value: 'bye' },
            ],
          },
          branches: { more: 'more_info', bye: 'bye_msg' },
        },
        more_info: {
          id: 'more_info',
          type: 'message',
          params: { text: 'Отлично! Здесь вы можете узнать о наших услугах, задать вопрос или оставить заявку.' },
          next: 'end',
        },
        bye_msg: {
          id: 'bye_msg',
          type: 'message',
          params: { text: 'Пока! Будем рады видеть вас снова.' },
          next: 'end',
        },
        end: {
          id: 'end',
          type: 'end',
          params: {},
        },
      },
    },
  },

  // 2. Викторина
  {
    id: 'quiz',
    name: 'Викторина',
    description: 'Три вопроса с вариантами ответов и подведение итогов в конце.',
    scenario: {
      version: 1,
      start: 'start',
      blocks: {
        start: {
          id: 'start',
          type: 'start',
          params: { command: '/start' },
          next: 'q1',
        },
        q1: {
          id: 'q1',
          type: 'message',
          params: { text: 'Вопрос 1: Какая столица Франции?' },
          next: 'q1_buttons',
        },
        q1_buttons: {
          id: 'q1_buttons',
          type: 'buttons',
          params: {
            prompt: 'Выберите ответ',
            layout: 'inline',
            buttons: [
              { label: 'Париж', value: 'a' },
              { label: 'Лондон', value: 'b' },
              { label: 'Берлин', value: 'c' },
            ],
          },
          // Все три ответа ведут дальше: в этом шаблоне нет подсчёта баллов,
          // но нажатие обязано куда-то приводить — иначе бот молчит.
          branches: { a: 'q2', b: 'q2', c: 'q2' },
        },
        q2: {
          id: 'q2',
          type: 'message',
          params: { text: 'Вопрос 2: Сколько будет 7 × 8?' },
          next: 'q2_buttons',
        },
        q2_buttons: {
          id: 'q2_buttons',
          type: 'buttons',
          params: {
            prompt: 'Выберите ответ',
            layout: 'inline',
            buttons: [
              { label: '54', value: 'a' },
              { label: '56', value: 'b' },
              { label: '64', value: 'c' },
            ],
          },
          branches: { a: 'q3', b: 'q3', c: 'q3' },
        },
        q3: {
          id: 'q3',
          type: 'message',
          params: { text: 'Вопрос 3: Какой океан самый большой?' },
          next: 'q3_buttons',
        },
        q3_buttons: {
          id: 'q3_buttons',
          type: 'buttons',
          params: {
            prompt: 'Выберите ответ',
            layout: 'inline',
            buttons: [
              { label: 'Атлантический', value: 'a' },
              { label: 'Тихий', value: 'b' },
              { label: 'Индийский', value: 'c' },
            ],
          },
          branches: { a: 'result', b: 'result', c: 'result' },
        },
        result: {
          id: 'result',
          type: 'message',
          params: { text: 'Спасибо за участие! Правильные ответы: Париж, 56, Тихий океан. Проверьте себя!' },
          next: 'end',
        },
        end: {
          id: 'end',
          type: 'end',
          params: {},
        },
      },
    },
  },

  // 3. Сбор отзыва
  {
    id: 'feedback',
    name: 'Сбор отзыва',
    description: 'Запрашивает оценку от 1 до 5 и благодарит по-разному в зависимости от результата.',
    scenario: {
      version: 1,
      start: 'start',
      blocks: {
        start: {
          id: 'start',
          type: 'start',
          params: { command: '/start' },
          next: 'greeting',
        },
        greeting: {
          id: 'greeting',
          type: 'message',
          params: { text: 'Спасибо, что пользуетесь нашим сервисом!' },
          next: 'ask_rating',
        },
        ask_rating: {
          id: 'ask_rating',
          type: 'input',
          params: { var: 'rating', kind: 'number', prompt: 'Оцените от 1 до 5' },
          next: 'check',
        },
        check: {
          id: 'check',
          type: 'condition',
          params: { condVar: 'rating', op: '>', condValue: '3' },
          branches: { then: 'good', else: 'bad' },
        },
        good: {
          id: 'good',
          type: 'message',
          params: { text: 'Спасибо за высокую оценку! Мы очень рады 💙' },
          next: 'end',
        },
        bad: {
          id: 'bad',
          type: 'message',
          params: { text: 'Нам жаль, что не всё понравилось. Расскажите, что улучшить?' },
          next: 'end',
        },
        end: {
          id: 'end',
          type: 'end',
          params: {},
        },
      },
    },
  },

  // 4. Воронка с подпиской
  {
    id: 'sub_funnel',
    name: 'Воронка с подпиской',
    description: 'Собирает email и предлагает подписаться на рассылку.',
    scenario: {
      version: 1,
      start: 'start',
      blocks: {
        start: {
          id: 'start',
          type: 'start',
          params: { command: '/start' },
          next: 'intro',
        },
        intro: {
          id: 'intro',
          type: 'message',
          params: { text: 'Добро пожаловать! Оставьте email, чтобы получать полезные материалы.' },
          next: 'ask_email',
        },
        ask_email: {
          id: 'ask_email',
          type: 'input',
          params: { var: 'email', kind: 'email', prompt: 'Введите ваш email' },
          next: 'thanks',
        },
        thanks: {
          id: 'thanks',
          type: 'message',
          params: { text: 'Спасибо, записали!' },
          next: 'subscribe_menu',
        },
        subscribe_menu: {
          id: 'subscribe_menu',
          type: 'buttons',
          params: {
            prompt: 'Хотите получать рассылку?',
            layout: 'inline',
            buttons: [
              { label: 'Подписаться', value: 'yes' },
              { label: 'Не сейчас', value: 'no' },
            ],
          },
          branches: { yes: 'subscribed', no: 'later' },
        },
        subscribed: {
          id: 'subscribed',
          type: 'message',
          params: { text: 'Готово! Вы подписаны. Ждите письма на {{email}}.' },
          next: 'end',
        },
        later: {
          id: 'later',
          type: 'message',
          params: { text: 'Хорошо, вы всегда можете подписаться позже.' },
          next: 'end',
        },
        end: {
          id: 'end',
          type: 'end',
          params: {},
        },
      },
    },
  },

  // 5. Меню FAQ
  {
    id: 'faq_menu',
    name: 'Меню FAQ',
    description: 'Главное меню с reply-кнопками: контакты, цены и часы работы.',
    scenario: {
      version: 1,
      start: 'start',
      blocks: {
        start: {
          id: 'start',
          type: 'start',
          params: { command: '/start' },
          next: 'menu',
        },
        menu: {
          id: 'menu',
          type: 'message',
          params: { text: 'Выберите раздел меню:' },
          next: 'menu_buttons',
        },
        menu_buttons: {
          id: 'menu_buttons',
          type: 'buttons',
          params: {
            prompt: 'Меню',
            layout: 'reply',
            buttons: [
              { label: 'Контакты', value: 'contacts' },
              { label: 'Цены', value: 'prices' },
              { label: 'Часы', value: 'hours' },
            ],
          },
          branches: { contacts: 'contacts', prices: 'prices', hours: 'hours' },
        },
        contacts: {
          id: 'contacts',
          type: 'message',
          params: { text: 'Наши контакты: support@example.com, +7 900 000-00-00.' },
          next: 'back',
        },
        prices: {
          id: 'prices',
          type: 'message',
          params: { text: 'Цены: базовый тариф — 990 ₽/мес, про — 2990 ₽/мес.' },
          next: 'back',
        },
        hours: {
          id: 'hours',
          type: 'message',
          params: { text: 'Мы работаем ежедневно с 9:00 до 21:00 по МСК.' },
          next: 'back',
        },
        back: {
          id: 'back',
          type: 'goto',
          params: { target: 'menu_buttons' },
        },
        end: {
          id: 'end',
          type: 'end',
          params: {},
        },
      },
    },
  },

  // 6. Заявка с уведомлением
  {
    id: 'notify',
    name: 'Заявка с уведомлением',
    description: 'Собирает имя и телефон, отправляет уведомление админу и подтверждает заявку.',
    scenario: {
      version: 1,
      start: 'start',
      blocks: {
        start: {
          id: 'start',
          type: 'start',
          params: { command: '/start' },
          next: 'ask_name',
        },
        ask_name: {
          id: 'ask_name',
          type: 'input',
          params: { var: 'name', kind: 'text', prompt: 'Введите ваше имя' },
          next: 'ask_phone',
        },
        ask_phone: {
          id: 'ask_phone',
          type: 'input',
          params: { var: 'phone', kind: 'text', prompt: 'Введите ваш телефон' },
          next: 'notify_admin',
        },
        notify_admin: {
          id: 'notify_admin',
          type: 'action',
          params: { actionKind: 'notify', notifyText: 'Новая заявка: {{name}}, {{phone}}' },
          next: 'done',
        },
        done: {
          id: 'done',
          type: 'message',
          params: { text: 'Заявка принята! Мы свяжемся с вами в ближайшее время.' },
          next: 'end',
        },
        end: {
          id: 'end',
          type: 'end',
          params: {},
        },
      },
    },
  },

  // 7. Квиз с баллами
  {
    id: 'quiz_score',
    name: 'Квиз с баллами',
    description: 'Три вопроса с вариантами ответов, подсчёт очков и итоговый результат.',
    scenario: {
      version: 1,
      start: 'start',
      blocks: {
        start: {
          id: 'start',
          type: 'start',
          params: { command: '/start' },
          next: 'init_score',
        },
        init_score: {
          id: 'init_score',
          type: 'setvar',
          params: { assignVar: 'score', expr: '0' },
          next: 'q1',
        },
        q1: {
          id: 'q1',
          type: 'message',
          params: { text: 'Вопрос 1 из 3: какая столица Франции?' },
          next: 'q1_ans',
        },
        q1_ans: {
          id: 'q1_ans',
          type: 'buttons',
          params: {
            prompt: 'Выберите ответ',
            layout: 'inline',
            buttons: [
              { label: 'Париж', value: 'a' },
              { label: 'Лондон', value: 'b' },
              { label: 'Берлин', value: 'c' },
            ],
          },
          branches: { a: 'q1_yes', b: 'q2', c: 'q2' },
        },
        q1_yes: {
          id: 'q1_yes',
          type: 'setvar',
          params: { assignVar: 'score', expr: '{{score}} + 1' },
          next: 'q2',
        },
        q2: {
          id: 'q2',
          type: 'message',
          params: { text: 'Вопрос 2 из 3: сколько будет 7 × 8?' },
          next: 'q2_ans',
        },
        q2_ans: {
          id: 'q2_ans',
          type: 'buttons',
          params: {
            prompt: 'Выберите ответ',
            layout: 'inline',
            buttons: [
              { label: '54', value: 'a' },
              { label: '56', value: 'b' },
              { label: '64', value: 'c' },
            ],
          },
          branches: { a: 'q3', b: 'q2_yes', c: 'q3' },
        },
        q2_yes: {
          id: 'q2_yes',
          type: 'setvar',
          params: { assignVar: 'score', expr: '{{score}} + 1' },
          next: 'q3',
        },
        q3: {
          id: 'q3',
          type: 'message',
          params: { text: 'Вопрос 3 из 3: какой океан самый большой?' },
          next: 'q3_ans',
        },
        q3_ans: {
          id: 'q3_ans',
          type: 'buttons',
          params: {
            prompt: 'Выберите ответ',
            layout: 'inline',
            buttons: [
              { label: 'Атлантический', value: 'a' },
              { label: 'Индийский', value: 'b' },
              { label: 'Тихий', value: 'c' },
            ],
          },
          branches: { a: 'check', b: 'check', c: 'q3_yes' },
        },
        q3_yes: {
          id: 'q3_yes',
          type: 'setvar',
          params: { assignVar: 'score', expr: '{{score}} + 1' },
          next: 'check',
        },
        check: {
          id: 'check',
          type: 'condition',
          params: { condVar: 'score', op: '>', condValue: '2' },
          branches: { then: 'win', else: 'lose' },
        },
        win: {
          id: 'win',
          type: 'message',
          params: { text: 'Почти идеально! Вы знаете очень много.' },
          next: 'result',
        },
        lose: {
          id: 'lose',
          type: 'message',
          params: { text: 'Неплохо, но есть над чем поработать 😉' },
          next: 'result',
        },
        result: {
          id: 'result',
          type: 'message',
          params: { text: 'Ваш результат: {{score}} из 3. Спасибо за игру!' },
          next: 'end',
        },
        end: {
          id: 'end',
          type: 'end',
          params: {},
        },
      },
    },
  },

  // 8. ИИ-помощник
  {
    id: 'ai_helper',
    name: 'ИИ-помощник',
    description: 'Меню с вопросом к ИИ и справкой о компании, ответ возвращает пользователя в меню.',
    scenario: {
      version: 1,
      start: 'start',
      blocks: {
        start: {
          id: 'start',
          type: 'start',
          params: { command: '/start' },
          next: 'menu',
        },
        menu: {
          id: 'menu',
          type: 'menu',
          params: {
            menuPrompt: 'Чем могу помочь?',
            buttons: [
              { label: 'Задать вопрос', value: 'ask' },
              { label: 'О нас', value: 'about' },
            ],
          },
          branches: { ask: 'ask_input', about: 'about' },
        },
        ask_input: {
          id: 'ask_input',
          type: 'input',
          params: { var: 'last_input', kind: 'text', prompt: 'Напишите ваш вопрос — отвечу сразу' },
          next: 'ai_answer',
        },
        ai_answer: {
          id: 'ai_answer',
          type: 'ai',
          params: {
            aiPrompt: 'Ответь на вопрос клиента: {{last_input}}',
            aiSystem: 'Ты вежливый консультант',
            aiVar: 'ai',
            aiReply: true,
          },
          next: 'back_to_menu',
        },
        back_to_menu: {
          id: 'back_to_menu',
          type: 'goto',
          params: { target: 'menu' },
          next: 'menu',
        },
        about: {
          id: 'about',
          type: 'message',
          params: { text: 'Мы — небольшая команда: делаем умных ботов и помогаем клиентам каждый день.' },
          next: 'about_back',
        },
        about_back: {
          id: 'about_back',
          type: 'goto',
          params: { target: 'menu' },
          next: 'menu',
        },
        help_cmd: {
          id: 'help_cmd',
          type: 'command',
          params: {
            command: '/help',
            description: 'Показать справку по боту',
            prompt: 'Просто напишите вопрос или выберите пункт меню.',
          },
          next: 'menu',
        },
      },
    },
  },

  // 9. Запись на услугу
  {
    id: 'booking',
    name: 'Запись на услугу',
    description: 'Собирает имя и телефон, уточняет дату, подтверждает запись и уведомляет администратора.',
    scenario: {
      version: 1,
      start: 'start',
      blocks: {
        start: {
          id: 'start',
          type: 'start',
          params: { command: '/start' },
          next: 'intro',
        },
        intro: {
          id: 'intro',
          type: 'message',
          params: { text: 'Запишу вас на удобное время. Как к вам обращаться?' },
          next: 'ask_name',
        },
        ask_name: {
          id: 'ask_name',
          type: 'input',
          params: { var: 'name', kind: 'text', prompt: 'Напишите ваше имя' },
          next: 'ask_phone',
        },
        ask_phone: {
          id: 'ask_phone',
          type: 'contact',
          params: { request: 'contact', var: 'phone', prompt: 'Отправьте номер телефона кнопкой ниже' },
          next: 'ask_date',
        },
        ask_date: {
          id: 'ask_date',
          type: 'buttons',
          params: {
            prompt: 'Когда вам удобно?',
            layout: 'inline',
            buttons: [
              { label: 'Завтра, 12:00', value: 'tomorrow' },
              { label: 'Пятница, 15:00', value: 'friday' },
            ],
          },
          branches: { tomorrow: 'confirm', friday: 'confirm' },
        },
        confirm: {
          id: 'confirm',
          type: 'message',
          params: { text: '{{name}}, вы записаны! Ждём вас и обязательно напомним о визите.' },
          next: 'notify_admin',
        },
        notify_admin: {
          id: 'notify_admin',
          type: 'action',
          params: { actionKind: 'notify', notifyText: 'Запись: {{name}}, {{phone}}' },
          next: 'end',
        },
        end: {
          id: 'end',
          type: 'end',
          params: {},
        },
      },
    },
  },
];
