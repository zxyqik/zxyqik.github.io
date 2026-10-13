/*
 * Финансовый ход — игровой движок.
 * Паттерны, очки, редкость, гаранты, генерация номеров и экономика.
 *
 * Файл не зависит от DOM: в браузере он доступен как window.FHEngine,
 * в Node.js — через require(). Позже этот же код будет работать на сервере,
 * чтобы результат выпуска считал сервер, а не клиент.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FHEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Настройки баланса. Все числа здесь — черновик для прототипа.        */
  /* ------------------------------------------------------------------ */

  var CONFIG = {
    startBalance: 13000,      // стартовый капитал, игровые ₽ (10 выпусков)
    issueCost: 1300,          // цена одного выпуска номера
    quickShare: 1,            // продажа системе — ровно по цене номера (одна цена везде)
    // Скидка за выпуск пачкой.
    batchDiscount: { 1: 0, 5: 0.02, 10: 0.03, 20: 0.05, 100: 0.07 },
    // Перекрутка цифры: выпадает случайная цифра 0–9. Цифры, которые сильно поднимают цену,
    // выпадают реже: вес = (новая цена / текущая)^−power. Попытка стоит чуть больше ожидаемого
    // выигрыша (feeMarkup), поэтому стабильно зарабатывать на перекрутке нельзя.
    reroll: { power: 1.2, feeMarkup: 1.3, minFee: 200 },
    numberLength: 7,
    daily: { base: 3000, perStreakDay: 500, maxStreak: 7 },
    sideJob: { amount: 1300, cooldownMs: 5 * 60 * 1000 }, // если не хватает на выпуск
    xpPerIssue: 10,
    levelReward: function (level) { return 500 * level; },
    // Отображение эквивалентов. 1 игровой $ = 100 игровых ₽, 1 игровой € = 110 ₽.
    currencies: {
      RUB: { symbol: '₽', perUnit: 1, name: 'игровые рубли' },
      USD: { symbol: '$', perUnit: 100, name: 'игровые доллары' },
      EUR: { symbol: '€', perUnit: 110, name: 'игровые евро' }
    }
  };

  // Сколько опыта нужно, чтобы перейти с уровня n на n+1.
  function xpToNext(level) { return 100 + 50 * (level - 1); }

  /*
   * Редкости. chance — шанс выпуска, minPoints — с какого количества очков
   * номер относится к редкости. price — цена номера в ₽ в начале и в конце
   * диапазона очков редкости: внутри цена растёт плавно, поэтому номер с более
   * сильной комбинацией всегда дороже. Top Secret — скрытая редкость:
   * ни шанс, ни цена не показываются игроку.
   */
  var TIERS = [
    { id: 'common',    name: 'Обычный',      minPoints: 0,    chance: null,     price: [400, 900],          xp: 0 },
    { id: 'rare',      name: 'Редкий',       minPoints: 30,   chance: 0.09,     price: [1300, 2600],        xp: 5 },
    { id: 'superrare', name: 'Сверхредкий',  minPoints: 70,   chance: 0.028,    price: [3500, 8000],        xp: 12 },
    { id: 'epic',      name: 'Эпический',    minPoints: 150,  chance: 0.002,    price: [35000, 120000],     xp: 25 },
    { id: 'legendary', name: 'Легендарный',  minPoints: 400,  chance: 0.0002,   price: [150000, 500000],    xp: 60 },
    { id: 'mythic',    name: 'Мифический',   minPoints: 1000, chance: 0.00001,  price: [1000000, 3000000],  xp: 200, maxPoints: 3000 },
    { id: 'secret',    name: 'Secret',       minPoints: null, chance: 0.000001, price: [10000000, 20000000], xp: 1000, hidden: true }
  ];
  TIERS[0].chance = 1 - TIERS.slice(1).reduce(function (s, t) { return s + t.chance; }, 0);

  var TIER_INDEX = {};
  TIERS.forEach(function (t, i) { TIER_INDEX[t.id] = i; });

  // Гаранты: если N выпусков подряд не было редкости не ниже указанной,
  // N-й выпуск гарантированно будет не ниже неё.
  var PITY = [
    { tier: 1, every: 10 },
    { tier: 2, every: 40 },
    { tier: 3, every: 700 },
    { tier: 4, every: 7000 }
  ];

  // Выдуманные сети. Код страны +0 не существует, позвонить невозможно.
  var COUNTRY = '+0';
  var NETWORKS = [
    { code: '010', name: 'Гудок' },
    { code: '020', name: 'Нольтел' },
    { code: '030', name: 'ФинСвязь' },
    { code: '040', name: 'Сигналыч' },
    { code: '050', name: 'Ход-Мобайл' }
  ];

  /* ------------------------------------------------------------------ */
  /* Случайность                                                        */
  /* ------------------------------------------------------------------ */

  function random() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (c && c.getRandomValues) {
      var buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return buf[0] / 4294967296;
    }
    return Math.random();
  }
  function randInt(n) { return Math.floor(random() * n); }
  function pick(arr) { return arr[randInt(arr.length)]; }

  /* ------------------------------------------------------------------ */
  /* Паттерны                                                           */
  /* ------------------------------------------------------------------ */

  var RUN_POINTS    = { 2: 4, 3: 20, 4: 70, 5: 260, 6: 900 };
  var LADDER_POINTS = { 3: 12, 4: 50, 5: 200, 6: 750 };
  var ALT_POINTS    = { 4: 25, 5: 80, 6: 280, 7: 900 };
  var PAIRS_POINTS  = { 2: 30, 3: 150 };
  var POINTS = {
    mirror: 300, smallMirror: 35, block: 120, twoDigits: 90,
    allDistinct: 15, parity: 30, roundTail: 8, sevens: 25, secret: 10000
  };
  var COMBO_STEP = 0.15, COMBO_MAX = 2, COMBO_MIN_POINTS = 10;

  var RUN_NAMES = { 2: 'Пара', 3: 'Тройка', 4: 'Каре', 5: 'Пятёрка', 6: 'Шестёрка' };

  // Справочник для экрана правил.
  var PATTERN_GUIDE = [
    { name: 'Повтор', example: '777', text: 'Одинаковые цифры подряд. Пара — 4, тройка — 20, четыре — 70, пять — 260, шесть — 900 очков.' },
    { name: 'Лесенка', example: '3456', text: 'Цифры подряд по возрастанию или убыванию на 1. Три — 12, четыре — 50, пять — 200, шесть — 750.' },
    { name: 'Зеркало', example: '1238321', text: 'Номер одинаково читается с обеих сторон — 300. Зеркальный кусок из пяти цифр — 35.' },
    { name: 'Чередование', example: '4545', text: 'Две цифры по очереди. Четыре — 25, пять — 80, шесть — 280, весь номер — 900.' },
    { name: 'Двойные пары', example: '1122', text: 'Пары разных цифр подряд. Две пары — 30, три пары — 150.' },
    { name: 'Повтор блока', example: '123123', text: 'Три цифры и сразу они же ещё раз — 120.' },
    { name: 'Две цифры', example: '5115151', text: 'Весь номер собран из двух разных цифр — 90.' },
    { name: 'Все разные', example: '1592640', text: 'Ни одна цифра не повторяется — 15.' },
    { name: 'Чётный / нечётный', example: '2486024', text: 'Все цифры чётные или все нечётные — 30.' },
    { name: 'Круглый хвост', example: '…00', text: 'Номер заканчивается на 00 — 8.' },
    { name: 'Семёрки', example: '7·7·7', text: 'В номере три семёрки или больше — 25.' },
    { name: 'Комбо', example: '×1.3', text: 'Каждый дополнительный паттерн от 10 очков добавляет ×0.15 к сумме, максимум ×2.' }
  ];

  function range(s, e) { var r = []; for (var i = s; i <= e; i++) r.push(i); return r; }
  function joinDigits(d, s, e) { return d.slice(s, e + 1).join(''); }

  // Максимальные отрезки [s, e], на которых выполняется условие.
  function segments(d, minLen, pred) {
    var out = [];
    for (var s = 0; s < d.length; s++) {
      for (var e = d.length - 1; e >= s + minLen - 1; e--) {
        if (!pred(s, e)) continue;
        var inside = out.some(function (g) { return g[0] <= s && e <= g[1]; });
        if (!inside) out.push([s, e]);
        break;
      }
    }
    return out;
  }

  function allSame(d, s, e) { for (var i = s + 1; i <= e; i++) if (d[i] !== d[s]) return false; return true; }
  function stepped(d, s, e, step) { for (var i = s + 1; i <= e; i++) if (d[i] - d[i - 1] !== step) return false; return true; }
  function alternating(d, s, e) {
    if (d[s] === d[s + 1]) return false;
    for (var i = s + 2; i <= e; i++) if (d[i] !== d[i - 2]) return false;
    return true;
  }
  function isPalindrome(d, s, e) {
    while (s < e) { if (d[s] !== d[e]) return false; s++; e--; }
    return true;
  }

  function findSecret(d) {
    var n = d.length;
    if (allSame(d, 0, n - 1)) return { name: 'Абсолют', text: 'Все семь цифр одинаковые.' };
    if (stepped(d, 0, n - 1, 1) || stepped(d, 0, n - 1, -1)) return { name: 'Полная лесенка', text: 'Весь номер — одна лесенка.' };
    var half = Math.floor(n / 2);
    if (isPalindrome(d, 0, n - 1) && (stepped(d, 0, half, 1) || stepped(d, 0, half, -1))) {
      return { name: 'Пирамида', text: 'Лесенка до середины и зеркально обратно.' };
    }
    return null;
  }

  function normalizeDigits(input) {
    var arr = Array.isArray(input) ? input.slice() : String(input).replace(/\D/g, '').split('');
    return arr.map(Number);
  }

  /**
   * Проверяет номер и объясняет, за что начислены очки.
   * Возвращает { digits, patterns, base, multiplier, points, tier }.
   */
  function evaluate(input) {
    var d = normalizeDigits(input);
    var n = d.length;
    if (n !== CONFIG.numberLength) throw new Error('Номер должен состоять из ' + CONFIG.numberLength + ' цифр');

    var secret = findSecret(d);
    if (secret) {
      return {
        digits: d,
        patterns: [{ id: 'secret', name: secret.name, text: secret.text, points: POINTS.secret, cells: range(0, n - 1) }],
        base: POINTS.secret, multiplier: 1, points: POINTS.secret, tier: TIER_INDEX.secret
      };
    }

    var patterns = [];
    function add(id, name, text, points, cells) {
      patterns.push({ id: id, name: name, text: text, points: points, cells: cells });
    }

    var runs = segments(d, 2, function (s, e) { return allSame(d, s, e); });
    runs.forEach(function (g) {
      var len = g[1] - g[0] + 1, str = joinDigits(d, g[0], g[1]);
      add('run', RUN_NAMES[len] + ' ' + str, len + ' одинаковые цифры подряд: ' + str + '.', RUN_POINTS[len], range(g[0], g[1]));
    });

    [1, -1].forEach(function (step) {
      segments(d, 3, function (s, e) { return stepped(d, s, e, step); }).forEach(function (g) {
        var len = g[1] - g[0] + 1, str = joinDigits(d, g[0], g[1]);
        add('ladder', 'Лесенка ' + str, len + ' цифры ' + (step > 0 ? 'по возрастанию' : 'по убыванию') + ' на 1: ' + str + '.',
          LADDER_POINTS[len], range(g[0], g[1]));
      });
    });

    var alts = segments(d, 4, function (s, e) { return alternating(d, s, e); });
    alts.forEach(function (g) {
      var len = g[1] - g[0] + 1, str = joinDigits(d, g[0], g[1]);
      add('alt', 'Чередование ' + str, 'Цифры ' + d[g[0]] + ' и ' + d[g[0] + 1] + ' идут по очереди ' + len + ' раз.',
        ALT_POINTS[len], range(g[0], g[1]));
    });

    if (isPalindrome(d, 0, n - 1)) {
      add('mirror', 'Зеркало', 'Номер одинаково читается слева направо и справа налево.', POINTS.mirror, range(0, n - 1));
    } else {
      for (var s = 0; s + 4 < n; s++) {
        var e = s + 4;
        var plain = isPalindrome(d, s, e) && !(d[s] === d[s + 2] && d[s + 1] === d[s + 3]);
        if (plain) {
          var str = joinDigits(d, s, e);
          add('smallMirror', 'Малое зеркало ' + str, 'Кусок ' + str + ' читается одинаково с обеих сторон.', POINTS.smallMirror, range(s, e));
          break;
        }
      }
    }

    // Двойные пары: AABB, AABBCC — соседние повторы ровно из двух цифр.
    var pairRuns = runs.filter(function (g) { return g[1] - g[0] === 1; });
    for (var p = 0; p < pairRuns.length; p++) {
      var k = 1;
      while (p + k < pairRuns.length && pairRuns[p + k][0] === pairRuns[p + k - 1][1] + 1) k++;
      if (k >= 2) {
        var ps0 = pairRuns[p][0], ps1 = pairRuns[p + k - 1][1], ps = joinDigits(d, ps0, ps1);
        add('pairs', (k === 3 ? 'Три пары ' : 'Две пары ') + ps, k + ' пары разных цифр подряд: ' + ps + '.', PAIRS_POINTS[k], range(ps0, ps1));
      }
      p += k - 1;
    }

    for (var b = 0; b + 5 < n; b++) {
      if (d[b] === d[b + 3] && d[b + 1] === d[b + 4] && d[b + 2] === d[b + 5] && !allSame(d, b, b + 2)) {
        var blk = joinDigits(d, b, b + 2);
        add('block', 'Повтор блока ' + blk + blk, 'Блок ' + blk + ' повторяется дважды подряд.', POINTS.block, range(b, b + 5));
        break;
      }
    }

    var distinct = {};
    d.forEach(function (x) { distinct[x] = true; });
    var distinctCount = Object.keys(distinct).length;
    if (distinctCount === 2) {
      add('twoDigits', 'Две цифры', 'Весь номер собран всего из двух цифр: ' + Object.keys(distinct).join(' и ') + '.', POINTS.twoDigits, range(0, n - 1));
    }
    if (distinctCount === n) {
      add('allDistinct', 'Все разные', 'Ни одна цифра не повторяется.', POINTS.allDistinct, range(0, n - 1));
    }

    var even = d.every(function (x) { return x % 2 === 0; });
    var odd = d.every(function (x) { return x % 2 === 1; });
    if (even || odd) {
      add('parity', even ? 'Все чётные' : 'Все нечётные', 'Все цифры ' + (even ? 'чётные' : 'нечётные') + '.', POINTS.parity, range(0, n - 1));
    }

    if (d[n - 1] === 0 && d[n - 2] === 0) {
      add('roundTail', 'Круглый хвост', 'Номер заканчивается на 00.', POINTS.roundTail, [n - 2, n - 1]);
    }

    var sevens = [];
    d.forEach(function (x, i) { if (x === 7) sevens.push(i); });
    if (sevens.length >= 3) {
      add('sevens', 'Семёрки ×' + sevens.length, 'В номере ' + sevens.length + ' семёрки — к удаче.', POINTS.sevens, sevens);
    }

    var base = patterns.reduce(function (sum, x) { return sum + x.points; }, 0);
    var significant = patterns.filter(function (x) { return x.points >= COMBO_MIN_POINTS; }).length;
    var multiplier = Math.min(COMBO_MAX, 1 + COMBO_STEP * Math.max(0, significant - 1));
    multiplier = Math.round(multiplier * 100) / 100;
    var points = Math.round(base * multiplier);
    patterns.sort(function (a, b2) { return b2.points - a.points; });

    return { digits: d, patterns: patterns, base: base, multiplier: multiplier, points: points, tier: tierForPoints(points) };
  }

  function tierForPoints(points) {
    var t = 0;
    for (var i = 0; i < TIERS.length; i++) {
      if (TIERS[i].minPoints !== null && points >= TIERS[i].minPoints) t = i;
    }
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* Выпуск: бросок редкости с гарантами и подбор номера под неё         */
  /* ------------------------------------------------------------------ */

  /**
   * pity — объект { rare, epic, legendary }: сколько выпусков подряд не было
   * такой редкости или выше. luck — множитель шансов (под бонусы телефонов).
   */
  function rollTier(pity, luck) {
    luck = luck || 1;
    var r = random(), acc = 0, rolled = 0;
    for (var i = TIERS.length - 1; i >= 1; i--) {
      acc += TIERS[i].chance * luck;
      if (r < acc) { rolled = i; break; }
    }
    var guaranteed = 0;
    PITY.forEach(function (rule) {
      var counter = (pity && pity[TIERS[rule.tier].id]) || 0;
      if (counter + 1 >= rule.every) guaranteed = Math.max(guaranteed, rule.tier);
    });
    return { tier: Math.max(rolled, guaranteed), byPity: guaranteed > rolled };
  }

  function nextPity(pity, tier) {
    var out = {};
    PITY.forEach(function (rule) {
      var id = TIERS[rule.tier].id;
      out[id] = tier >= rule.tier ? 0 : ((pity && pity[id]) || 0) + 1;
    });
    return out;
  }

  function pityLeft(pity) {
    return PITY.map(function (rule) {
      var id = TIERS[rule.tier].id;
      return { tier: rule.tier, id: id, name: TIERS[rule.tier].name, left: rule.every - ((pity && pity[id]) || 0) };
    });
  }

  function randomDigits() {
    var d = [];
    for (var i = 0; i < CONFIG.numberLength; i++) d.push(randInt(10));
    return d;
  }

  // «Подсадки» паттернов в случайный номер — чтобы быстро найти номер нужной редкости.
  var INJECTIONS = [
    function run(d) { var len = 2 + randInt(5), s = randInt(d.length - len + 1), v = randInt(10); for (var i = 0; i < len; i++) d[s + i] = v; },
    function ladder(d) {
      var len = 3 + randInt(4), s = randInt(d.length - len + 1), step = random() < 0.5 ? 1 : -1;
      var v = step > 0 ? randInt(10 - len + 1) : len - 1 + randInt(10 - len + 1);
      for (var i = 0; i < len; i++) d[s + i] = v + step * i;
    },
    function alt(d) {
      var len = 4 + randInt(4), s = randInt(d.length - len + 1), a = randInt(10), b = (a + 1 + randInt(9)) % 10;
      for (var i = 0; i < len; i++) d[s + i] = i % 2 ? b : a;
    },
    function mirror(d) { for (var i = 0; i < 3; i++) d[d.length - 1 - i] = d[i]; },
    function pairs(d) {
      var k = 2 + randInt(2), s = randInt(d.length - 2 * k + 1);
      for (var j = 0; j < k; j++) { var v = randInt(10); d[s + 2 * j] = v; d[s + 2 * j + 1] = v; }
    },
    function block(d) { var s = randInt(2); for (var i = 0; i < 3; i++) d[s + 3 + i] = d[s + i]; },
    function twoDigits(d) {
      var a = randInt(10), b = (a + 1 + randInt(9)) % 10;
      for (var i = 0; i < d.length; i++) d[i] = d[i] % 2 ? a : b;
    },
    function parity(d) { var odd = random() < 0.5 ? 1 : 0; for (var i = 0; i < d.length; i++) d[i] = (d[i] - (d[i] % 2)) + odd; }
  ];

  function secretNumbers() {
    var list = [], n = CONFIG.numberLength, i, v;
    for (v = 0; v < 10; v++) list.push(Array(n).fill(v));
    for (v = 0; v + n - 1 <= 9; v++) {
      var up = [], down = [];
      for (i = 0; i < n; i++) { up.push(v + i); down.push(9 - v - i); }
      list.push(up, down);
    }
    var half = Math.floor(n / 2);
    for (v = 0; v + half <= 9; v++) {
      var a = [], b = [];
      for (i = 0; i < n; i++) { var k = half - Math.abs(half - i); a.push(v + k); b.push(9 - v - k); }
      list.push(a, b);
    }
    return list;
  }
  var SECRET_NUMBERS = secretNumbers();

  function digitsForTier(tier) {
    if (tier === TIER_INDEX.secret) return pick(SECRET_NUMBERS).slice();
    for (var attempt = 0; attempt < 50000; attempt++) {
      var d = randomDigits();
      if (tier > 0) {
        var count = 1 + randInt(Math.min(3, tier + 1));
        for (var j = 0; j < count; j++) pick(INJECTIONS)(d);
      }
      var ev = evaluate(d);
      if (ev.tier === tier) return d;
    }
    throw new Error('Не удалось подобрать номер редкости ' + tier);
  }

  /** Полный выпуск: бросок редкости, номер, сеть, оценка. */
  function issueNumber(pity, luck) {
    var roll = rollTier(pity, luck);
    var digits = digitsForTier(roll.tier);
    var ev = evaluate(digits);
    return {
      digits: digits.join(''),
      network: pick(NETWORKS).code,
      evaluation: ev,
      tier: ev.tier,
      byPity: roll.byPity,
      pity: nextPity(pity, ev.tier)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Экономика                                                          */
  /* ------------------------------------------------------------------ */

  function niceRound(v) { var step = v >= 100000 ? 1000 : v >= 10000 ? 100 : 10; return Math.round(v / step) * step; }

  /**
   * Цена номера. Внутри редкости растёт плавно (по логарифмической шкале) от нижней
   * границы к верхней — чем сильнее комбинация, тем дороже номер.
   */
  function marketPrice(evaluation) {
    var t = evaluation.tier, tier = TIERS[t], f;
    if (tier.id === 'secret') {
      var h = 0; evaluation.digits.forEach(function (x, i) { h = (h * 31 + x * (i + 7)) % 997; });
      f = h / 996;
    } else {
      var lo = tier.minPoints;
      var hi = TIERS[t + 1] && TIERS[t + 1].minPoints ? TIERS[t + 1].minPoints - 1 : (tier.maxPoints || lo * 3);
      f = Math.max(0, Math.min(1, (evaluation.points - lo) / (hi - lo)));
    }
    return niceRound(tier.price[0] * Math.pow(tier.price[1] / tier.price[0], f));
  }
  /** Цена «продать сразу» — часть цены номера. */
  function quickSellPrice(evaluation) { return niceRound(marketPrice(evaluation) * CONFIG.quickShare); }

  function xpForIssue(tier) { return CONFIG.xpPerIssue + TIERS[tier].xp; }

  function batchCost(n) {
    var d = CONFIG.batchDiscount[n] || 0;
    return Math.round(n * CONFIG.issueCost * (1 - d));
  }

  /* ------------------------------------------------------------------ */
  /* Перекрутка одной цифры                                              */
  /* ------------------------------------------------------------------ */

  function withDigit(d, pos, x) { return d.slice(0, pos) + x + d.slice(pos + 1); }
  function priceOf(d) { return quickSellPrice(evaluate(d)); }

  /**
   * Условия перекрутки цифры на позиции pos: все 10 исходов с шансами и ценами,
   * итоговые шансы «дороже / так же / дешевле» и стоимость попытки.
   */
  function rerollQuote(digits, pos) {
    var R = CONFIG.reroll;
    digits = String(digits);
    var v0 = priceOf(digits), outcomes = [], sum = 0;
    for (var x = 0; x < 10; x++) {
      var d = withDigit(digits, pos, String(x)), v = priceOf(d);
      var w = v > v0 ? Math.pow(v / v0, -R.power) : 1;
      outcomes.push({ digit: String(x), digits: d, price: v, tier: evaluate(d).tier, w: w });
      sum += w;
    }
    var up = 0, same = 0, down = 0, gain = 0, best = null;
    outcomes.forEach(function (o) {
      o.p = o.w / sum;
      if (o.price > v0) { up += o.p; gain += o.p * (o.price - v0); if (!best || o.price > best.price) best = o; }
      else if (o.price < v0) down += o.p;
      else same += o.p;
    });
    return {
      from: digits, pos: pos, v0: v0, outcomes: outcomes, pUp: up, pSame: same, pDown: down, best: best,
      fee: Math.max(R.minFee, niceRound(gain * R.feeMarkup))
    };
  }
  /** Бросок перекрутки: возвращает выпавшую цифру и итог. */
  function rerollRoll(q, r) {
    if (r === undefined) r = random();
    var acc = 0, pick = q.outcomes[q.outcomes.length - 1];
    for (var i = 0; i < q.outcomes.length; i++) { acc += q.outcomes[i].p; if (r < acc) { pick = q.outcomes[i]; break; } }
    return { digit: pick.digit, digits: pick.digits, outcome: pick.price > q.v0 ? 'up' : pick.price < q.v0 ? 'down' : 'same', price: pick.price };
  }

  /**
   * Апгрейдер: подобрать номер с ценой около target (±tolerance).
   * Если за отведённые попытки такой номер не нашёлся — null (тогда игроку выдаются деньги).
   */
  function findNumberNear(target, tolerance, tries) {
    tolerance = tolerance || 0.12; tries = tries || 1200;
    var tier = -1;
    for (var t = 0; t < TIERS.length - 1; t++) {
      var lo = TIERS[t].price[0] * (1 - tolerance), hi = TIERS[t].price[1] * (1 + tolerance);
      if (target >= lo && target <= hi) { tier = t; break; }
    }
    if (tier < 0) return null;
    var best = null, bestDiff = Infinity;
    for (var i = 0; i < tries; i++) {
      var d = digitsForTier(tier).join(''), p = marketPrice(evaluate(d)), diff = Math.abs(p - target) / target;
      if (diff < bestDiff) { bestDiff = diff; best = d; }
      if (diff <= tolerance / 3) break;
    }
    return bestDiff <= tolerance ? best : null;
  }

  /** Начисляет опыт, возвращает новый уровень и награды за уровни. */
  function applyXp(level, xp, gained) {
    xp += gained;
    var ups = [];
    while (xp >= xpToNext(level)) {
      xp -= xpToNext(level);
      level++;
      ups.push({ level: level, reward: CONFIG.levelReward(level) });
    }
    return { level: level, xp: xp, levelUps: ups };
  }

  function dailyReward(streak) {
    return CONFIG.daily.base + CONFIG.daily.perStreakDay * (Math.min(streak, CONFIG.daily.maxStreak) - 1);
  }

  /* ------------------------------------------------------------------ */
  /* Форматирование                                                     */
  /* ------------------------------------------------------------------ */

  function formatDigits(digits) {
    var s = String(digits);
    return s.slice(0, 3) + '-' + s.slice(3, 5) + '-' + s.slice(5, 7);
  }
  function formatNumber(network, digits) { return COUNTRY + ' ' + network + ' ' + formatDigits(digits); }
  function networkName(code) {
    for (var i = 0; i < NETWORKS.length; i++) if (NETWORKS[i].code === code) return NETWORKS[i].name;
    return 'Неизвестная сеть';
  }

  function formatMoney(amountRub, currency) {
    var cur = CONFIG.currencies[currency] || CONFIG.currencies.RUB;
    var value = amountRub / cur.perUnit;
    var digits = cur.perUnit === 1 ? 0 : 2;
    var text = value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return currency === 'RUB' || !CONFIG.currencies[currency] ? text + ' ₽' : cur.symbol + text;
  }

  return {
    CONFIG: CONFIG, TIERS: TIERS, TIER_INDEX: TIER_INDEX, PITY: PITY, NETWORKS: NETWORKS, COUNTRY: COUNTRY,
    PATTERN_GUIDE: PATTERN_GUIDE, SECRET_NUMBERS: SECRET_NUMBERS,
    evaluate: evaluate, tierForPoints: tierForPoints, rollTier: rollTier, nextPity: nextPity, pityLeft: pityLeft,
    digitsForTier: digitsForTier, issueNumber: issueNumber,
    marketPrice: marketPrice, quickSellPrice: quickSellPrice, xpForIssue: xpForIssue, batchCost: batchCost, rerollQuote: rerollQuote, rerollRoll: rerollRoll, findNumberNear: findNumberNear, xpToNext: xpToNext, applyXp: applyXp, dailyReward: dailyReward,
    formatDigits: formatDigits, formatNumber: formatNumber, networkName: networkName, formatMoney: formatMoney
  };
});
