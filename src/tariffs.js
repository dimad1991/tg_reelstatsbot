// Tariff plans configuration
export const TARIFF_PLANS = {
  TEST: {
    name: 'Test',
    maxChecks: 5,
    durationDays: 0, // No expiration for test plan
    price: 0,
    priceLabel: 'Бесплатно'
  },
  S: {
    name: 'S',
    maxChecks: 50,
    durationDays: 31,
    price: 79000, // 790 rubles in kopecks
    priceLabel: '790 руб/мес'
  },
  M: {
    name: 'M',
    maxChecks: 100,
    durationDays: 31,
    price: 119000, // 1,190 rubles in kopecks
    priceLabel: '1 190 руб/мес'
  },
  L: {
    name: 'L',
    maxChecks: 300,
    durationDays: 31,
    price: 297000, // 2,970 rubles in kopecks
    priceLabel: '2 970 руб/мес'
  },
  FREE: {
    name: 'Free',
    maxChecks: Infinity,
    durationDays: 0, // No expiration for free plan
    price: 0,
    priceLabel: 'Бесплатно'
  }
};

// Message templates for tariff-related notifications
export const MESSAGES = {
  LIMIT_REACHED_TEST: `
А этот бот хорош, да?
 
Вы потратили все бесплатные проверки. Подключите платный тариф и верните доступ ко всем возможностям бота:
 
 • Полная статистика Instagram аккаунта в 2 клика
 • Полная статистика Instagram Reels блогера
 • Прогноз охватов будущих Reels в аккаунте
 
2780 человек уже купили тариф. 
 
ВЫБРАТЬ ПАКЕТ ⬇️`,

  LIMIT_REACHED_PAID: `
Кажется, не рассчитали силы и вам нужен пакет побольше.
 
Вы потратили все проверки на своем тарифе. Продлите текущий тариф или подключите пакет побольше
 
2780 человек уже купили тариф. 
 
ВЫБРАТЬ ПАКЕТ ⬇️`
};

// Payment button options
export const PAYMENT_BUTTONS = [
  {
    text: '50 проверок за 790 руб/мес',
    tariff: 'S'
  },
  {
    text: '🔥100 проверок за 1 190 руб/мес',
    tariff: 'M'
  },
  {
    text: '300 проверок за 2 970 руб/мес',
    tariff: 'L'
  },
  {
    text: 'Запросить спец. условия',
    url: 'https://t.me/dimadubovik'
  }
];
