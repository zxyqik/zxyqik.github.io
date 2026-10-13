/*
 * Финансовый ход — игровые операции над состоянием игрока и мира.
 *
 * Одна реализация для страницы (демо без сервера) и для сервера:
 *   P — состояние игрока (баланс, склад, уровень, история…),
 *   W — общие настройки мира (ивент, объявление, промокоды, свои регионы, админы…).
 * Операции меняют P и W на месте и возвращают результат для интерфейса.
 * Если действие невозможно, бросают ошибку с текстом для игрока (err.game === true).
 *
 * В браузере — window.FHGame (после engine.js), в Node.js — require('./game.js').
 */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var api = factory(node ? require('./engine.js') : root.FHEngine);
  if (node) module.exports = api;
  else root.FHGame = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  var CAP = 1000;                         // сколько номеров помещается на склад
  var SIZES = [1, 5, 10, 20, 100];        // выпуск пачкой
  var MULTS = [1.5, 2, 3, 5, 10, 20];     // множители апгрейдера
  var STAKE_MAX = 10;
  var LOG_MAX = 300, ADMIN_LOG_MAX = 200, HIST_MAX = 20;
  var GIFT_MAX = 10;                      // сколько номеров можно подарить за день

  /*
   * Страны — настоящие коды, операторы и их коды — выдуманные.
   * Код оператора начинается с 0: во всех этих странах ноль — внутренний префикс набора
   * и после кода страны не набирается, а в США код зоны не может начинаться с 0 или 1.
   * Россия и Казахстан делят +7, поэтому коды операторов у них не пересекаются.
   */
  // [ключ, название, код, раздел, группы цифр, разделитель, операторы, значок вместо флага]
  var COUNTRY_LIST = [
    ['ru', 'Россия', '7', 'main', [3, 2, 2], '-', [['010', 'Гудок', 'bell', '#FF5A3C', 'sq'], ['020', 'Нольтел', 'zero', '#2A2D31', 'ci'], ['030', 'ФинСвязь', 'chev', '#1DAA5C', 'sq'], ['040', 'Сигналыч', 'bars', '#6B57FF', 'sq'], ['050', 'Ход-Мобайл', 'tri', '#F2A30F', 'ci']]],
    ['jp', 'Япония', '81', 'main', [3, 4], '-', [['010', 'Sakura Mobile', 'spark', '#E8507A', 'ci'], ['020', 'Kaze Tel', 'wave', '#2D6BFF', 'sq'], ['030', 'Neko Net', 'moon', '#2A2D31', 'sq']]],
    ['de', 'Германия', '49', 'main', [3, 4], ' ', [['010', 'Klingel', 'bell', '#2A2D31', 'sq'], ['020', 'Funkhaus', 'arcs', '#DD0000', 'sq'], ['030', 'Nullnetz', 'zero', '#FFCE00', 'ci']]],
    ['us', 'США', '1', 'main', [3, 4], '-', [['011', 'Ringo', 'ring', '#E8384F', 'ci'], ['022', 'Zerotel', 'zero', '#2D6BFF', 'sq'], ['033', 'Lucky Line', 'clover', '#1F9D55', 'sq']]],
    ['kz', 'Казахстан', '7', 'main', [3, 2, 2], '-', [['060', 'Дала Мобайл', 'sun', '#00AFCA', 'ci'], ['070', 'Алтын Тел', 'spark', '#E3A400', 'sq'], ['080', 'Степь', 'wave', '#3E8E5E', 'bare']]],
    ['th', 'Таиланд', '66', 'main', [3, 4], '-', [['010', 'Siam Line', 'crown', '#2D2A4A', 'sq'], ['020', 'Tuk-Tuk Tel', 'wheel', '#F2A30F', 'ci'], ['030', 'Lotus Mobile', 'tulip', '#E8384F', 'sq']]],
    ['ae', 'ОАЭ', '971', 'main', [3, 4], ' ', [['010', 'Falcon Mobile', 'chev', '#00732F', 'sq'], ['020', 'Oasis Tel', 'drop', '#00AFCA', 'ci'], ['030', 'Dune Net', 'peak', '#C98A16', 'sq']]],
    ['cn', 'Китай', '86', 'main', [3, 4], ' ', [['010', 'Long Tel', 'bolt', '#EE1C25', 'sq'], ['020', 'Panda Mobile', 'half', '#2A2D31', 'ci'], ['030', 'Bamboo Net', 'leaf', '#1F9D55', 'sq']]],
    ['se', 'Швеция', '46', 'main', [3, 2, 2], ' ', [['010', 'Ringa', 'arcs', '#006AA7', 'sq'], ['020', 'Fika Mobil', 'cup', '#FECC02', 'ci'], ['030', 'Älg Tel', 'plus', '#2E7D32', 'sq']]],
    ['ch', 'Швейцария', '41', 'main', [3, 2, 2], ' ', [['010', 'Alpenhorn', 'peak', '#DA291C', 'sq'], ['020', 'Uhrwerk Tel', 'wheel', '#2A2D31', 'ci'], ['030', 'Käse Mobile', 'grid', '#F2BE3A', 'sq']]],
    ['anon', 'Аноним', '888', 'special', [3, 2, 2], '-', [['088', 'Аноним Связь', 'half', '#2A2D31', 'ci']], { t: '888', bg: '#0D0F11' }]
  ];

  /* ---------------- мелочи ---------------- */
  var nf = new Intl.NumberFormat('ru-RU');
  function money(n) { return nf.format(Math.round(n)) + ' ₽'; }
  function plural(n, a, b, c) { var m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; }
  function fmtMult(m) { return '×' + String(m).replace('.', ','); }
  function fail(text) { var e = new Error(text); e.game = true; throw e; }
  function rnd() { return Math.random(); }
  var seq = 0;
  function uid() { seq++; return 'n' + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 7); }
  function nowOf(ctx) { return ctx && ctx.now || Date.now(); }
  // Ключ дня по местному времени (на сервере — по его часовому поясу).
  function dayKey(now, offsetDays) {
    var d = new Date(now + (offsetDays || 0) * 864e5);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function isSecretTier(t) { return t === E.TIER_INDEX.secret; }
  var evCache = {}, evCount = 0;
  // Оценка зависит только от цифр — кэшируем.
  function evaluate(d) {
    var ev = evCache[d];
    if (!ev) { if (++evCount > 8000) { evCache = {}; evCount = 1; } ev = evCache[d] = E.evaluate(d); }
    return ev;
  }

  /* ---------------- состояния ---------------- */
  function freshPlayer() {
    return { v: 5, balance: E.CONFIG.startBalance, level: 1, xp: 0, pity: {}, items: [], last: null,
      daily: { last: null, streak: 0 }, jobAt: 0, issued: 0, best: null, log: [], tot: {},
      buyers: null, upg: { n: 0, win: 0 }, redeemed: [], forceTier: null, main: null, gifts: null, prefs: null, ach: null, gave: 0 };
  }
  function freshWorld() {
    return { event: null, notice: null, holiday: 'none', promos: [], custom: { regions: [], ops: {}, admins: [] },
      buyersSeed: 0, buyersNow: false, adminLog: [] };
  }
  var PLAYER_KEYS = Object.keys(freshPlayer());
  var WORLD_KEYS = Object.keys(freshWorld());
  // Дополнить недостающие поля (после обновлений игры).
  function normPlayer(P) { var f = freshPlayer(); PLAYER_KEYS.forEach(function (k) { if (P[k] === undefined) P[k] = f[k]; }); return P; }
  function normWorld(W) {
    var f = freshWorld(); WORLD_KEYS.forEach(function (k) { if (W[k] === undefined) W[k] = f[k]; });
    if (!W.custom.regions) W.custom.regions = []; if (!W.custom.ops) W.custom.ops = {}; if (!W.custom.admins) W.custom.admins = [];
    return W;
  }
  function pick(obj, keys) { var o = {}; keys.forEach(function (k) { o[k] = obj[k]; }); return o; }

  /* ---------------- страны ---------------- */
  // Встроенные страны + регионы и операторы, созданные разработчиком (W.custom).
  function countries(W) {
    var map = {}, order = [];
    function add(c) { map[c.key] = c; order.push(c.key); }
    COUNTRY_LIST.forEach(function (c) { add({ key: c[0], name: c[1], code: c[2], region: c[3], groups: c[4], sep: c[5], nets: c[6].slice(), badge: c[7] }); });
    var cu = (W && W.custom) || { regions: [], ops: {} };
    (cu.regions || []).forEach(function (r) { add({ key: r.key, name: r.name, code: r.code, region: 'custom', groups: r.groups, sep: r.sep, badge: r.badge, nets: r.nets.slice() }); });
    Object.keys(cu.ops || {}).forEach(function (k) { if (map[k]) map[k].nets = map[k].nets.concat(cu.ops[k]); });
    return { map: map, order: order };
  }
  function fmtFull(item, cs) {
    var c = cs.map[item.c] || cs.map.ru, out = [], p = 0;
    c.groups.forEach(function (n) { out.push(item.d.slice(p, p + n)); p += n; });
    return '+' + c.code + ' (' + item.net + ') ' + out.join(c.sep);
  }
  function pickCountry(cs, key) {
    if (key === 'any' || !cs.map[key]) key = key === 'any' ? cs.order[Math.floor(rnd() * cs.order.length)] : 'ru';
    return cs.map[key];
  }
  function randomNet(c) { return c.nets[Math.floor(rnd() * c.nets.length)][0]; }

  /* ---------------- история денег и журнал админов ---------------- */
  function logMoney(P, k, a, x, extra, now) {
    var e = { t: now || Date.now(), k: k, a: Math.round(a || 0), x: x };
    if (extra) Object.keys(extra).forEach(function (p) { e[p] = Math.round(extra[p]); });
    P.log.unshift(e); if (P.log.length > LOG_MAX) P.log.length = LOG_MAX;
    if (e.a) { var tt = P.tot[k] || (P.tot[k] = [0, 0]); if (e.a < 0) tt[0] -= e.a; else tt[1] += e.a; }
  }
  function adminLog(W, ctx, a, x) {
    W.adminLog.unshift({ t: nowOf(ctx), who: (ctx && ctx.user && ctx.user.username) || '', to: (ctx && ctx.target) || '', a: a, x: x || '' });
    if (W.adminLog.length > ADMIN_LOG_MAX) W.adminLog.length = ADMIN_LOG_MAX;
  }

  /* ---------------- склад ---------------- */
  function findItem(P, id) { for (var i = 0; i < P.items.length; i++) if (P.items[i].id === id) return P.items[i]; return null; }
  function freeSlots(P) { return CAP - P.items.length; }
  function noteBest(P, item) {
    var ev = evaluate(item.d);
    if (!P.best || ev.points > P.best.p) P.best = { d: item.d, c: item.c, net: item.net, p: ev.points };
  }
  function addItem(P, c, d, net, note, now) {
    var ev = evaluate(d), it = { id: uid(), c: c.key, d: d, net: net || randomNet(c), t: ev.tier, ts: now || Date.now() };
    if (note) it.h = [{ t: it.ts, x: note }];
    P.items.unshift(it); noteBest(P, it);
    return it;
  }
  function removeItems(P, set) {
    var gone = [];
    P.items = P.items.filter(function (x) { if (set[x.id]) { gone.push(x); return false; } return true; });
    if (P.last && set[P.last]) P.last = null;
    if (P.main && set[P.main]) P.main = null;
    return gone;
  }

  /* ---------------- ивенты и цена выпуска ---------------- */
  function eventNow(W, now) {
    var e = W.event; if (!e) return null;
    if ((e.until && (now || Date.now()) >= e.until) || (e.left != null && e.left <= 0)) { W.event = null; return null; }
    return e;
  }
  function costOf(W, n, now) {
    var e = eventNow(W, now), c = E.batchCost(n);
    return e && e.kind === 'sale' ? Math.round(c * (1 - e.v) / 10) * 10 : c;
  }
  function noticeNow(W, now) { var n = W.notice; if (!n) return null; if (n.until && (now || Date.now()) >= n.until) { W.notice = null; return null; } return n; }
  function dailyStatus(P, now) {
    now = now || Date.now();
    if (P.daily.last === dayKey(now, 0)) return { available: false };
    var streak = P.daily.last === dayKey(now, -1) ? P.daily.streak + 1 : 1;
    return { available: true, streak: streak, reward: E.dailyReward(streak) };
  }

  /* ---------------- скупщики: трое в день, заявки детерминированы датой ---------------- */
  var BUYER_NAMES = ['Аркадий Коллекционер', 'Барон Нулей', 'Тётя Зина', 'Сеня Перекуп', 'Мистер Лаки', 'Дядя Гоша', 'Нумеролог Ян', 'Профессор Цифра', 'Лёха с рынка', 'Мадам Семёрка'];
  function seeded(str) {
    for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    var a = h >>> 0;
    return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function maxRun(d) { var best = 1, cur = 1; for (var i = 1; i < d.length; i++) { cur = d[i] === d[i - 1] ? cur + 1 : 1; if (cur > best) best = cur; } return best; }
  function hasPat(ev, ids) { return ev.patterns.some(function (p) { return ids.indexOf(p.id) >= 0; }); }
  function mainKeys() { return COUNTRY_LIST.filter(function (c) { return c[3] === 'main'; }).map(function (c) { return c[0]; }); }
  // [вес, вид заявки, во сколько раз дороже цены, сколько номеров возьмёт, нужна ли страна]
  var WANTS = [
    [3, 'pair', 1.2, 3, true], [2, 'any', 1.15, 3, true], [2, 'run3', 1.3, 2], [2, 'ladder', 1.3, 2], [2, 'mirror', 1.35, 2],
    [2, 'tail00', 1.25, 2], [2, 'sevens', 1.2, 3], [1.5, 'distinct', 1.2, 2],
    [3, 'tier1', 1.3, 2], [2, 'tier2', 1.4, 1], [1.2, 'tier3', 1.6, 1], [0.5, 'tier4', 2, 1]
  ];
  var WANT_TEXT = {
    pair: 'Две одинаковые цифры подряд', any: 'Любой номер', run3: 'Три одинаковые цифры подряд', ladder: 'Лесенка из трёх цифр, например 345',
    mirror: 'Зеркальный кусок, например 12321', tail00: 'Номер заканчивается на 00', sevens: 'Минимум две семёрки', distinct: 'Все цифры разные'
  };
  function buyerAccepts(b, item, ev) {
    switch (b.k) {
      case 'pair': return item.c === b.c && maxRun(item.d) >= 2;
      case 'any': return item.c === b.c;
      case 'run3': return maxRun(item.d) >= 3;
      case 'ladder': return hasPat(ev, ['ladder']);
      case 'mirror': return hasPat(ev, ['mirror', 'smallMirror']);
      case 'tail00': return item.d.slice(-2) === '00';
      case 'sevens': return item.d.split('7').length > 2;
      case 'distinct': return hasPat(ev, ['allDistinct']);
      default: return b.tier != null && ev.tier === b.tier;
    }
  }
  // Трое скупщиков дня: { i, hour, name, nameIdx, k, c?, tier?, text?, mult, qty }.
  function buyersFor(day, seed) {
    var r = seeded('fh-buyers|' + day + (seed ? '|' + seed : '')), used = {}, names = {}, list = [];
    var total = WANTS.reduce(function (s, w) { return s + w[0]; }, 0);
    for (var i = 0; i < 3; i++) {
      var idx;
      do { var x = r() * total; idx = 0; while (idx < WANTS.length - 1 && x >= WANTS[idx][0]) { x -= WANTS[idx][0]; idx++; } } while (used[idx]);
      used[idx] = true;
      var w = WANTS[idx], b = { k: w[1], mult: w[2], qty: w[3] };
      if (w[4]) { var keys = mainKeys(); b.c = keys[Math.floor(r() * keys.length)]; }
      if (w[1].indexOf('tier') === 0) b.tier = Number(w[1].slice(4));
      else b.text = WANT_TEXT[w[1]];
      var ni; do { ni = Math.floor(r() * BUYER_NAMES.length); } while (names[ni]);
      names[ni] = true;
      b.i = i; b.hour = i * 8; b.name = BUYER_NAMES[ni]; b.nameIdx = ni;
      list.push(b);
    }
    return list;
  }
  function buyersToday(P, W, now) {
    now = now || Date.now();
    var day = dayKey(now, 0);
    if (!P.buyers || P.buyers.day !== day || (P.buyers.seed || 0) !== (W.buyersSeed || 0)) P.buyers = { day: day, seed: W.buyersSeed || 0, sold: {} };
    return buyersFor(day, W.buyersSeed || 0);
  }
  function buyerState(b, P, W, now) {
    if (!W.buyersNow && new Date(now || Date.now()).getHours() < b.hour) return 'wait';
    return ((P.buyers && P.buyers.sold[b.i]) || 0) >= b.qty ? 'done' : 'open';
  }
  function buyerPrice(b, ev) { return Math.round(E.marketPrice(ev) * b.mult / 10) * 10; }

  /* ---------------- апгрейдер ---------------- */
  function upgChance(m) { return 0.8 / m; }   // игра забирает 20% ставки в среднем
  // Шанс апгрейда на конкретный номер: 80% × ставка / цена цели, не больше 90%.
  function upgChanceFor(val, price) { return Math.min(0.9, 0.8 * val / price); }
  // Цель апгрейда — конкретный номер с ценой как можно ближе к target. У редкостей между ценами
  // есть разрывы (например, 8 000 → 35 000), поэтому цель «прилипает» к ближайшей существующей цене.
  function prizeFor(target) {
    var best = null;
    for (var t = 0; t < E.TIERS.length - 1; t++) {
      var pr = E.TIERS[t].price, aim = Math.min(pr[1], Math.max(pr[0], target)), dist = Math.abs(Math.log(aim / target));
      if (!best || dist < best.dist) best = { t: t, aim: aim, dist: dist };
    }
    var d = E.findNumberNear(best.aim, 0.06, 500) || E.findNumberNear(best.aim, 0.12, 1200) || E.digitsForTier(best.t).join('');
    var ev = evaluate(d);
    return { d: d, price: E.marketPrice(ev), t: ev.tier };
  }
  // В какую редкость попадёт цель (как в E.findNumberNear: границы редкости ±12%); -1 — номера такой цены не бывает.
  function tierForPrice(p) {
    for (var t = 0; t < E.TIERS.length - 1; t++) { var pr = E.TIERS[t].price; if (p >= pr[0] * 0.88 && p <= pr[1] * 1.12) return t; }
    return -1;
  }

  /* ================= операции игрока ================= */
  var OPS = {};

  // Выпуск n номеров. a = { n, country }.
  OPS.issue = function (P, W, a, ctx) {
    var now = nowOf(ctx), n = Number(a.n), cs = countries(W);
    if (SIZES.indexOf(n) < 0) fail('Можно выпускать по 1, 5, 10, 20 или 100 номеров.');
    if (n > freeSlots(P)) fail('На складе нет места: максимум ' + CAP + ' номеров.');
    var cost = costOf(W, n, now);
    if (P.balance < cost) fail('Не хватает денег: нужно ' + money(cost) + '.');
    P.balance -= cost;
    logMoney(P, 'issue', -cost, n === 1 ? 'Выпуск номера' : 'Выпуск ×' + n, null, now);
    var evt = eventNow(W, now), made = [], reward = 0, ups = [];
    for (var k = 0; k < n; k++) {
      var luck = 1;
      if (evt && (evt.left == null || evt.left > 0)) {
        if (evt.kind === 'luck') luck = evt.v;
        if (evt.left != null) evt.left--;
      }
      var r;
      if (P.forceTier != null) {
        var fd = E.digitsForTier(P.forceTier).join(''), fev = E.evaluate(fd);
        r = { digits: fd, evaluation: fev, pity: E.nextPity(P.pity, fev.tier) }; P.forceTier = null;
      } else r = E.issueNumber(P.pity, luck);
      P.pity = r.pity;
      var c = pickCountry(cs, a.country), ev = r.evaluation;
      var item = { id: uid(), c: c.key, d: r.digits, net: randomNet(c), t: ev.tier, ts: now };
      P.items.unshift(item); P.issued++; noteBest(P, item);
      var lv = E.applyXp(P.level, P.xp, E.xpForIssue(ev.tier)); P.level = lv.level; P.xp = lv.xp;
      lv.levelUps.forEach(function (u) { reward += u.reward; ups.push(u); logMoney(P, 'bonus', u.reward, 'Уровень ' + u.level, null, now); });
      made.push(item);
    }
    P.balance += reward;
    var top = made.reduce(function (x, y) { return evaluate(y.d).points > evaluate(x.d).points ? y : x; });
    P.last = top.id;
    return { cost: cost, made: made, top: top.id, ups: ups, reward: reward };
  };

  // Продажа системе. a = { ids }.
  OPS.sell = function (P, W, a, ctx) {
    var set = {}, cs = countries(W);
    (a.ids || []).forEach(function (id) { var x = findItem(P, id); if (x && !x.lock) set[id] = true; });
    var sold = removeItems(P, set), total = 0;
    if (!sold.length) fail('Нечего продавать.');
    sold.forEach(function (x) { total += E.quickSellPrice(evaluate(x.d)); });
    P.balance += total;
    logMoney(P, 'sell', total, sold.length === 1 ? 'Продажа ' + fmtFull(sold[0], cs) : 'Продажа ' + sold.length + ' ' + plural(sold.length, 'номера', 'номеров', 'номеров'), null, nowOf(ctx));
    return { total: total, n: sold.length, ids: sold.map(function (x) { return x.id; }) };
  };

  // Закрепить / открепить. a = { id, on }.
  OPS.lock = function (P, W, a) {
    var x = findItem(P, a.id); if (!x) fail('Номер не найден.');
    if (a.on) x.lock = true; else delete x.lock;
    return { lock: !!x.lock };
  };

  // Перекрутка одной цифры. a = { id, pos }.
  OPS.reroll = function (P, W, a, ctx) {
    var now = nowOf(ctx), x = findItem(P, a.id), pos = Number(a.pos), cs = countries(W);
    if (!x) fail('Номер не найден.');
    if (!(pos >= 0 && pos < 7)) fail('Выберите цифру.');
    var q = E.rerollQuote(x.d, pos);
    if (P.balance < q.fee) fail('Не хватает: нужно ' + money(q.fee) + '.');
    P.balance -= q.fee;
    logMoney(P, 'reroll', -q.fee, 'Перекрутка ' + (pos + 1) + '-й цифры · ' + fmtFull(x, cs), null, now);
    var res = E.rerollRoll(q), before = x.d;
    x.d = res.digits; x.t = evaluate(x.d).tier;
    x.h = (x.h || []).concat([{ t: now, x: 'Перекрутка ' + (pos + 1) + '-й цифры: ' + before.charAt(pos) + ' → ' + res.digit + (res.outcome === 'same' ? '' : res.outcome === 'up' ? ' (дороже)' : ' (дешевле)') }]).slice(-HIST_MAX);
    noteBest(P, x);
    return { id: x.id, pos: pos, digit: res.digit, before: before, digits: x.d, outcome: res.outcome, fee: q.fee, diff: E.quickSellPrice(evaluate(x.d)) - q.v0 };
  };

  // Апгрейдер. a = { ids, m }. r — куда встал бегунок (0…1), выигрыш при r < шанса.
  OPS.upgrade = function (P, W, a, ctx) {
    var now = nowOf(ctx), m = Number(a.m), ids = (a.ids || []).filter(function (id, i, arr) { return arr.indexOf(id) === i; }), cs = countries(W);
    if (!a.prize && MULTS.indexOf(m) < 0) fail('Такого множителя нет.');
    if (!ids.length) fail('Выберите номера для ставки.');
    if (ids.length > STAKE_MAX) fail('В ставке максимум ' + STAKE_MAX + ' номеров.');
    var stake = ids.map(function (id) {
      var x = findItem(P, id);
      if (!x) fail('Номер из ставки не найден — обновите страницу.');
      if (x.lock) fail('Закреплённый номер нельзя ставить.');
      if (isSecretTier(evaluate(x.d).tier)) fail('Secret нельзя ставить.');
      return x;
    });
    var val = stake.reduce(function (s, x) { return s + E.marketPrice(evaluate(x.d)); }, 0);
    if (a.prize) return upgradeTo(P, W, a, ctx, stake, ids, val);
    var target = Math.round(val * m / 10) * 10, r = rnd(), win = r < upgChance(m);
    var set = {}; ids.forEach(function (id) { set[id] = true; });
    removeItems(P, set);
    var res = { win: win, r: r, val: val, m: m, target: target }, what = 'Апгрейд ' + fmtMult(m) + ': ' + stake.length + ' ' + plural(stake.length, 'номер', 'номера', 'номеров');
    P.upg.n++;
    if (win) {
      P.upg.win++;
      var d = E.findNumberNear(target);
      if (d) {
        // новый номер — из страны самого дорогого номера ставки
        var src = stake.reduce(function (x, y) { return E.marketPrice(evaluate(y.d)) > E.marketPrice(evaluate(x.d)) ? y : x; });
        var it = addItem(P, cs.map[src.c] || cs.map.ru, d, null, 'Получен в апгрейдере ' + fmtMult(m), now);
        res.item = it.id; res.tier = it.t;
        logMoney(P, 'upgrade', 0, what + ' → номер', { v: E.marketPrice(evaluate(d)) - val }, now);
      } else {
        res.cash = target; P.balance += target;
        logMoney(P, 'upgrade', target, what + ' → деньгами', null, now);
      }
    } else logMoney(P, 'upgrade', 0, what + ' → мимо', { v: -val }, now);
    return res;
  };

  // Апгрейд на выбранный номер: цена цели известна заранее, шанс считается от неё — какой показан, такой и есть.
  function upgradeTo(P, W, a, ctx, stake, ids, val) {
    var now = nowOf(ctx), cs = countries(W), pz = a.prize || {}, c = cs.map[pz.c], d = String(pz.d || '');
    if (!/^\d{7}$/.test(d) || !c) fail('Цель не найдена — выбери её заново.');
    var pev = evaluate(d);
    if (isSecretTier(pev.tier)) fail('Такую цель выбрать нельзя.');
    var price = E.marketPrice(pev);
    if (price < val * 1.1) fail('Цель должна быть дороже ставки хотя бы на 10%.');
    if (price > val * 200) fail('Цель слишком дорогая для такой ставки.');
    var chance = upgChanceFor(val, price), r = rnd(), win = r < chance, set = {}, m = Math.round(price / val * 10) / 10;
    ids.forEach(function (id) { set[id] = true; });
    removeItems(P, set);
    P.upg.n++;
    var what = 'Апгрейд ×' + String(m).replace('.', ',') + ': ' + stake.length + ' ' + plural(stake.length, 'номер', 'номера', 'номеров');
    var res = { win: win, r: r, val: val, price: price, chance: chance, m: m };
    if (win) {
      P.upg.win++;
      var net = c.nets.some(function (n) { return n[0] === pz.net; }) ? pz.net : null;
      var it = addItem(P, c, d, net, 'Получен в апгрейдере ×' + String(m).replace('.', ','), now);
      res.item = it.id; res.tier = it.t;
      logMoney(P, 'upgrade', 0, what + ' → номер', { v: price - val }, now);
    } else logMoney(P, 'upgrade', 0, what + ' → мимо', { v: -val }, now);
    return res;
  }

  OPS.daily = function (P, W, a, ctx) {
    var now = nowOf(ctx), st = dailyStatus(P, now);
    if (!st.available) fail('Награда дня уже получена — приходи завтра.');
    P.daily = { last: dayKey(now, 0), streak: st.streak, best: Math.max(st.streak, P.daily.best || 0) }; P.balance += st.reward;
    logMoney(P, 'bonus', st.reward, 'Награда дня', null, now);
    return { reward: st.reward, streak: st.streak };
  };

  OPS.job = function (P, W, a, ctx) {
    var now = nowOf(ctx), wait = P.jobAt + E.CONFIG.sideJob.cooldownMs - now;
    if (wait > 0) fail('Подработка будет доступна через ' + Math.ceil(wait / 1000) + ' с.');
    P.jobAt = now; P.balance += E.CONFIG.sideJob.amount;
    logMoney(P, 'bonus', E.CONFIG.sideJob.amount, 'Подработка', null, now);
    return { amount: E.CONFIG.sideJob.amount };
  };

  // Продажа скупщику. a = { b, id }.
  OPS.buyerSell = function (P, W, a, ctx) {
    var now = nowOf(ctx), bs = buyersToday(P, W, now), b = bs[Number(a.b)], x = findItem(P, a.id), cs = countries(W);
    if (!b) fail('Скупщик не найден.');
    if (buyerState(b, P, W, now) !== 'open') fail('Скупщик сейчас не покупает.');
    if (!x) fail('Номер не найден.');
    var ev = evaluate(x.d);
    if (x.lock || isSecretTier(ev.tier) || !buyerAccepts(b, x, ev)) fail('Этот номер скупщику не подходит.');
    var pay = buyerPrice(b, ev), set = {}; set[x.id] = true;
    removeItems(P, set);
    P.balance += pay; P.buyers.sold[b.i] = (P.buyers.sold[b.i] || 0) + 1;
    logMoney(P, 'buyer', pay, b.name + ': ' + fmtFull(x, cs), null, now);
    return { pay: pay, name: b.name, id: x.id };
  };

  // Промокод. a = { code }.
  OPS.redeem = function (P, W, a, ctx) {
    var now = nowOf(ctx), code = String(a.code || '').toUpperCase().replace(/\s/g, ''), cs = countries(W);
    var p = W.promos.filter(function (x) { return x.code === code; })[0];
    if (!code) fail('Введи код.');
    if (!p) fail('Такого кода нет.');
    if (P.redeemed.indexOf(code) >= 0) fail('Этот код уже активирован.');
    if (p.until && now >= p.until) fail('Срок кода истёк.');
    if (p.limit && p.used >= p.limit) fail('Код уже ввели максимальное число раз.');
    if (p.kind === 'tier' && freeSlots(P) <= 0) fail('Склад полон — освободи место.');
    p.used++; P.redeemed.push(code);
    if (p.kind === 'money') { P.balance += p.v; logMoney(P, 'bonus', p.v, 'Промокод ' + code, null, now); return { kind: 'money', amount: p.v }; }
    var it = addItem(P, pickCountry(cs, a.country || 'any'), E.digitsForTier(p.v).join(''), null, 'Промокод ' + code, now);
    logMoney(P, 'bonus', 0, 'Промокод ' + code + ' → номер ' + fmtFull(it, cs), null, now);
    return { kind: 'tier', item: it.id };
  };

  // Основной номер — показывается в топе игроков. a = { id } (без id — убрать).
  OPS.setMain = function (P, W, a) {
    if (!a.id) { P.main = null; return { main: null }; }
    if (!findItem(P, a.id)) fail('Номер не найден.');
    P.main = a.id;
    return { main: a.id };
  };

  // Начать заново: всё по игроку с нуля (настройки мира и интерфейса не трогаем).
  OPS.reset = function (P) {
    var f = freshPlayer(), prefs = P.prefs;
    PLAYER_KEYS.forEach(function (k) { P[k] = f[k]; });
    P.prefs = prefs;
    return {};
  };

  // Настройки интерфейса (тема, звук, страна…) — хранятся у игрока, чтобы не терялись при перезаходе.
  var VIEWS = ['list', 'tiles', 'cards'], THEMES = ['auto', 'light', 'dark'];
  OPS.prefs = function (P, W, a) {
    var x = a.prefs || {}, out = {};
    if (THEMES.indexOf(x.theme) >= 0) out.theme = x.theme;
    if (typeof x.sound === 'boolean') out.sound = x.sound;
    if (typeof x.fast === 'boolean') out.fast = x.fast;
    if (typeof x.country === 'string' && /^[a-z0-9]{1,16}$/.test(x.country)) out.country = x.country;
    if (SIZES.indexOf(x.batch) >= 0) out.batch = x.batch;
    if (VIEWS.indexOf(x.stockView) >= 0) out.stockView = x.stockView;
    if (Array.isArray(x.favs)) out.favs = x.favs.filter(function (k) { return typeof k === 'string' && /^[a-z0-9]{1,16}$/.test(k); }).slice(0, 40);
    P.prefs = out;
    return { prefs: out };
  };

  /* ================= достижения ================= */
  // Награда — в выпусках (k × цена выпуска), поэтому при смене цен награды меняются вместе с ними.
  function bestTier(P) { return P.best ? evaluate(P.best.d).tier : -1; }
  var ACH = [
    { id: 'first', title: 'Первый номер', text: 'Выпусти первый номер', goal: 1, k: 1, val: function (P) { return P.issued; } },
    { id: 'issue100', title: 'Сотня', text: 'Выпусти 100 номеров', goal: 100, k: 5, val: function (P) { return P.issued; } },
    { id: 'issue1000', title: 'Конвейер', text: 'Выпусти 1 000 номеров', goal: 1000, k: 25, val: function (P) { return P.issued; } },
    { id: 'superrare', title: 'Глаз намётан', text: 'Получи сверхредкий номер', goal: 1, k: 2, val: function (P) { return bestTier(P) >= 2 ? 1 : 0; } },
    { id: 'epic', title: 'Эпично', text: 'Получи эпический номер', goal: 1, k: 10, val: function (P) { return bestTier(P) >= 3 ? 1 : 0; } },
    { id: 'legendary', title: 'Легенда', text: 'Получи легендарный номер', goal: 1, k: 50, val: function (P) { return bestTier(P) >= 4 ? 1 : 0; } },
    { id: 'upg1', title: 'Рискнул', text: 'Выиграй в апгрейдере', goal: 1, k: 2, val: function (P) { return P.upg.win; } },
    { id: 'upg10', title: 'Везунчик', text: 'Выиграй в апгрейдере 10 раз', goal: 10, k: 10, val: function (P) { return P.upg.win; } },
    { id: 'lvl5', title: 'В деле', text: 'Дойди до 5 уровня', goal: 5, k: 3, val: function (P) { return P.level; } },
    { id: 'lvl10', title: 'Магнат', text: 'Дойди до 10 уровня', goal: 10, k: 10, val: function (P) { return P.level; } },
    { id: 'streak7', title: 'Неделя подряд', text: 'Забирай награду дня 7 дней подряд', goal: 7, k: 7, val: function (P) { return Math.max(P.daily.streak || 0, P.daily.best || 0); } },
    { id: 'gift', title: 'Щедрый', text: 'Подари номер другому игроку', goal: 1, k: 2, val: function (P) { return P.gave || 0; } }
  ];
  function achList(P) {
    var got = P.ach || {};
    return ACH.map(function (a) {
      var v = Math.min(a.goal, Number(a.val(P)) || 0);
      return { id: a.id, title: a.title, text: a.text, goal: a.goal, val: v, done: v >= a.goal, claimed: !!got[a.id], reward: a.k * E.CONFIG.issueCost };
    });
  }
  // Сколько наград ждут, чтобы их забрали (для точки в меню).
  function achReady(P) { return achList(P).filter(function (a) { return a.done && !a.claimed; }).length; }
  OPS.ach = function (P, W, a, ctx) {
    var now = nowOf(ctx), it = achList(P).filter(function (x) { return x.id === a.id; })[0];
    if (!it) fail('Нет такого достижения.');
    if (it.claimed) fail('Награда уже получена.');
    if (!it.done) fail('Достижение ещё не выполнено.');
    P.ach = P.ach || {}; P.ach[it.id] = now; P.balance += it.reward;
    logMoney(P, 'bonus', it.reward, 'Достижение «' + it.title + '»', null, now);
    return { id: it.id, reward: it.reward };
  };

  /* ================= подарок: номер переходит от P к TP ================= */
  // a = { id }, ctx = { now, from, to } — имена для истории. Получателя находит сервер.
  function gift(P, TP, W, a, ctx) {
    var now = nowOf(ctx), x = findItem(P, a.id), cs = countries(W), day = dayKey(now, 0);
    if (!x) fail('Номер не найден.');
    if (x.lock) fail('Закреплённый номер не передать — сначала открепи его.');
    if (freeSlots(TP) <= 0) fail('У получателя полный склад.');
    if (!P.gifts || P.gifts.day !== day) P.gifts = { day: day, n: 0 };
    if (P.gifts.n >= GIFT_MAX) fail('Сегодня уже подарено ' + GIFT_MAX + ' номеров — приходи завтра.');
    var set = {}; set[x.id] = true;
    removeItems(P, set);
    P.gifts.n++; P.gave = (P.gave || 0) + 1;
    x.h = (x.h || []).concat([{ t: now, x: 'Подарок от ' + ctx.from + ' для ' + ctx.to }]).slice(-HIST_MAX);
    TP.items.unshift(x); noteBest(TP, x);
    var num = fmtFull(x, cs);
    logMoney(P, 'gift', 0, 'Подарок ' + ctx.to + ': ' + num, null, now);
    logMoney(TP, 'gift', 0, 'Подарок от ' + ctx.from + ': ' + num, null, now);
    return { id: x.id, num: num, tier: evaluate(x.d).tier, left: GIFT_MAX - P.gifts.n };
  }

  /* ================= сводка игрока для топа ================= */
  // worth — склад по цене продажи (без Secret), best — очки лучшего номера на складе,
  // card — номер для показа в топе: основной, а если его нет — лучший.
  function playerStats(P) {
    var worth = 0, best = null, bestP = -1, secret = 0, main = P.main ? findItem(P, P.main) : null;
    P.items.forEach(function (x) {
      var ev = evaluate(x.d);
      if (isSecretTier(ev.tier)) secret++; else worth += E.marketPrice(ev);
      if (ev.points > bestP) { bestP = ev.points; best = x; }
    });
    var show = main || best, card = function (x) { return { d: x.d, c: x.c, net: x.net, t: evaluate(x.d).tier }; };
    return { worth: worth, best: Math.max(0, bestP), level: P.level, secret: secret, items: P.items.length,
      card: show ? Object.assign(card(show), { main: !!main, b: card(best) }) : null };
  }

  /* ================= действия администратора над игроком ================= */
  var TIER_NAMES = E.TIERS.map(function (t) { return t.name; });
  var ADMIN_TITLES = {
    give: 'Выдать деньги', take: 'Забрать деньги', set: 'Задать баланс', num: 'Номер по цифрам', rand: 'Случайные номера', force: 'Следующий выпуск',
    level: 'Уровень', pity: 'Сбросить гаранты', daily: 'Награда дня снова', job: 'Подработка сразу', unlock: 'Открепить все', wipe: 'Очистить склад', reset: 'Сбросить игрока'
  };
  // a = { kind, amt, d, c, net, tier, count, level, country }. Возвращает { msg }.
  function adminAct(P, W, a, ctx) {
    var now = nowOf(ctx), cs = countries(W), k = a.kind, msg;
    if (!ADMIN_TITLES[k]) fail('Неизвестное действие.');
    if (k === 'give' || k === 'take' || k === 'set') {
      var amt = Math.max(0, Math.min(1e10, Math.floor(Number(a.amt) || 0)));
      if (k === 'give') { if (!amt) fail('Укажите сумму.'); P.balance += amt; logMoney(P, 'dev', amt, 'Выдано разработчиком', null, now); msg = 'Выдано +' + money(amt); }
      else if (k === 'take') { var tk = Math.min(amt, P.balance); if (!tk) fail('Нечего забирать.'); P.balance -= tk; logMoney(P, 'dev', -tk, 'Списано разработчиком', null, now); msg = 'Списано −' + money(tk); }
      else { var diff = amt - P.balance; P.balance = amt; logMoney(P, 'dev', diff, 'Баланс задан разработчиком', null, now); msg = 'Баланс: ' + money(amt); }
    } else if (k === 'num') {
      var d = String(a.d || '');
      if (!/^\d{7}$/.test(d)) fail('Нужно ровно 7 цифр.');
      if (freeSlots(P) <= 0) fail('Склад полон: ' + CAP + ' номеров.');
      var c = cs.map[a.c] || cs.map.ru, net = c.nets.some(function (x) { return x[0] === a.net; }) ? a.net : null;
      var it = addItem(P, c, d, net, 'Выдан разработчиком', now);
      msg = 'Выдан ' + fmtFull(it, cs);
    } else if (k === 'rand') {
      var t = Number(a.tier), n = Math.min(Math.max(1, Math.floor(Number(a.count) || 1)), 100, freeSlots(P));
      if (!(t >= 0 && t < E.TIERS.length)) fail('Выберите редкость.');
      if (n <= 0) fail('Склад полон: ' + CAP + ' номеров.');
      for (var i = 0; i < n; i++) addItem(P, pickCountry(cs, a.country || 'any'), E.digitsForTier(t).join(''), null, 'Выдан разработчиком', now);
      msg = 'Выдано ' + n + ' ' + plural(n, 'номер', 'номера', 'номеров') + ' · ' + TIER_NAMES[t];
    } else if (k === 'force') {
      var ft = Number(a.tier); if (!(ft >= 0 && ft < E.TIERS.length)) fail('Выберите редкость.');
      P.forceTier = ft; msg = 'Следующий выпуск: ' + TIER_NAMES[ft];
    } else if (k === 'level') { var lv = Math.max(1, Math.min(999, Math.floor(Number(a.level) || 1))); P.level = lv; P.xp = 0; msg = 'Уровень ' + lv; }
    else if (k === 'pity') { P.pity = {}; msg = 'Гаранты сброшены'; }
    else if (k === 'daily') { P.daily = { last: dayKey(now, -1), streak: Math.max(0, (P.daily.streak || 1) - 1) }; msg = 'Награду дня можно забрать снова'; }
    else if (k === 'job') { P.jobAt = 0; msg = 'Подработка доступна'; }
    else if (k === 'unlock') { var cnt = 0; P.items.forEach(function (x) { if (x.lock) { delete x.lock; cnt++; } }); msg = 'Откреплено: ' + cnt; }
    else if (k === 'wipe') { msg = 'Склад очищен: ' + P.items.length; P.items = []; P.last = null; }
    else if (k === 'reset') { OPS.reset(P); msg = 'Прогресс сброшен'; }
    adminLog(W, ctx, ADMIN_TITLES[k], msg);
    return { msg: msg };
  }

  /* ================= настройки мира (только администраторы) ================= */
  var EV_KINDS = { luck: [2, 3, 5], sale: [0.1, 0.2, 0.3] };
  function eventTitle(e) { return e.kind === 'luck' ? 'Удача ×' + e.v : 'Скидка ' + Math.round(e.v * 100) + '%'; }
  // a = { kind, ... }. Возвращает { msg }.
  function worldOp(W, a, ctx) {
    var now = nowOf(ctx), k = a.kind, msg;
    if (k === 'eventStart') {
      if (!EV_KINDS[a.ev] || EV_KINDS[a.ev].indexOf(Number(a.v)) < 0) fail('Такого ивента нет.');
      var e = { kind: a.ev, v: Number(a.v) };
      if (a.left) e.left = Math.min(1000, Math.max(1, Math.floor(Number(a.left))));
      else e.until = now + Math.min(168, Math.max(1, Number(a.hours) || 1)) * 3600e3;
      W.event = e; msg = eventTitle(e); adminLog(W, ctx, 'Ивент запущен', msg);
    } else if (k === 'eventStop') { msg = W.event ? eventTitle(W.event) : ''; W.event = null; adminLog(W, ctx, 'Ивент остановлен', msg); }
    else if (k === 'notice') {
      var text = String(a.text || '').trim().slice(0, 140); if (!text) fail('Напиши текст объявления.');
      var hrs = Number(a.hours) || 0;
      W.notice = { text: text, until: hrs ? now + Math.min(720, hrs) * 3600e3 : 0 }; msg = text; adminLog(W, ctx, 'Объявление', text);
    } else if (k === 'noticeOff') { W.notice = null; msg = 'Объявление убрано'; adminLog(W, ctx, 'Объявление убрано', ''); }
    else if (k === 'buyersNew') { W.buyersSeed = (W.buyersSeed || 0) + 1; msg = buyersFor(dayKey(now, 0), W.buyersSeed).map(function (b) { return b.name; }).join(', '); adminLog(W, ctx, 'Новые скупщики', msg); }
    else if (k === 'buyersNow') { W.buyersNow = !!a.on; msg = W.buyersNow ? 'вкл' : 'выкл'; adminLog(W, ctx, 'Скупщики приходят сразу', msg); }
    else if (k === 'holiday') {
      if (['none', 'newyear', 'halloween', 'valentine'].indexOf(a.holiday) < 0) fail('Такого оформления нет.');
      W.holiday = a.holiday; msg = a.holiday; adminLog(W, ctx, 'Оформление', a.holiday);
    } else if (k === 'promoCreate') {
      var code = String(a.code || '').toUpperCase().replace(/\s/g, ''), kind = a.promoKind === 'tier' ? 'tier' : 'money';
      var v = kind === 'money' ? Math.min(1e9, Math.floor(Number(a.v) || 0)) : Number(a.v);
      if (!/^[A-Z0-9]{4,16}$/.test(code)) fail('Код: 4–16 латинских букв и цифр.');
      if (W.promos.some(function (p) { return p.code === code; })) fail('Такой код уже есть.');
      if (kind === 'money' && v <= 0) fail('Укажите сумму.');
      if (kind === 'tier' && !(v >= 0 && v < E.TIERS.length)) fail('Выберите редкость.');
      var days = Number(a.days) || 0;
      var p = { code: code, kind: kind, v: v, limit: Math.max(0, Math.floor(Number(a.limit) || 0)), used: 0, until: days ? now + days * 864e5 : 0, t: now };
      W.promos.unshift(p); msg = code; adminLog(W, ctx, 'Промокод создан', code + ' · ' + (kind === 'money' ? money(v) : TIER_NAMES[v] + ' номер'));
    } else if (k === 'promoDelete') { W.promos = W.promos.filter(function (p) { return p.code !== a.code; }); msg = a.code; adminLog(W, ctx, 'Промокод удалён', a.code); }
    else if (k === 'adminAdd') {
      var nm = String(a.username || '').toLowerCase().replace(/^@/, '');
      if (!/^[a-z0-9_]{3,32}$/.test(nm)) fail('Юзернейм: латиница, цифры и _');
      W.custom.admins = W.custom.admins.filter(function (x) { return x !== nm; }).concat([nm]); msg = '@' + nm; adminLog(W, ctx, 'Добавлен разработчик', msg);
    } else if (k === 'adminDel') { W.custom.admins = W.custom.admins.filter(function (x) { return x !== a.username; }); msg = '@' + a.username; adminLog(W, ctx, 'Убран разработчик', msg); }
    else if (k === 'regionSave') {
      var r = a.region || {};
      if (!r.name || !/^\d{1,4}$/.test(r.code || '')) fail('Укажите название и код страны.');
      var reg = { name: String(r.name).slice(0, 24), code: r.code, groups: (r.groups || [3, 2, 2]).map(Number), sep: r.sep === ' ' ? ' ' : '-', badge: r.badge };
      if (reg.groups.reduce(function (s, x) { return s + x; }, 0) !== 7) fail('Формат номера — 7 цифр.');
      if (r.key) {
        var ex = W.custom.regions.filter(function (x) { return x.key === r.key; })[0]; if (!ex) fail('Регион не найден.');
        Object.keys(reg).forEach(function (f) { ex[f] = reg[f]; });
      } else {
        if (!a.op || !/^\d{3}$/.test(a.op[0] || '')) fail('Нужен первый оператор с кодом из 3 цифр.');
        reg.key = 'x' + now.toString(36); reg.nets = [a.op]; W.custom.regions.push(reg);
      }
      msg = reg.name; adminLog(W, ctx, 'Регион сохранён', reg.name + ' +' + reg.code);
    } else if (k === 'regionDel') { W.custom.regions = W.custom.regions.filter(function (x) { return x.key !== a.key; }); msg = a.key; adminLog(W, ctx, 'Регион удалён', a.key); }
    else if (k === 'opAdd') {
      var o = a.op; if (!o || !/^\d{3}$/.test(o[0] || '') || !o[1]) fail('Код оператора — 3 цифры, нужно название.');
      var cs = countries(W); if (!cs.map[a.country]) fail('Страна не найдена.');
      if (cs.map[a.country].nets.some(function (n) { return n[0] === o[0]; })) fail('В этом регионе уже есть оператор с кодом ' + o[0] + '.');
      var region = W.custom.regions.filter(function (x) { return x.key === a.country; })[0];
      if (region) region.nets.push(o); else W.custom.ops[a.country] = (W.custom.ops[a.country] || []).concat([o]);
      msg = o[1]; adminLog(W, ctx, 'Оператор добавлен', o[1] + ' · ' + cs.map[a.country].name);
    } else if (k === 'opDel') {
      W.custom.ops[a.country] = (W.custom.ops[a.country] || []).filter(function (n) { return n[0] !== a.code; });
      if (!W.custom.ops[a.country].length) delete W.custom.ops[a.country];
      var rg = W.custom.regions.filter(function (x) { return x.key === a.country; })[0];
      if (rg && rg.nets.length > 1) rg.nets = rg.nets.filter(function (n) { return n[0] !== a.code; });
      msg = a.code; adminLog(W, ctx, 'Оператор удалён', a.code);
    } else fail('Неизвестная настройка.');
    return { msg: msg };
  }

  return {
    CAP: CAP, SIZES: SIZES, MULTS: MULTS, STAKE_MAX: STAKE_MAX, COUNTRY_LIST: COUNTRY_LIST, BUYER_NAMES: BUYER_NAMES, TIER_NAMES: TIER_NAMES, ADMIN_TITLES: ADMIN_TITLES,
    PLAYER_KEYS: PLAYER_KEYS, WORLD_KEYS: WORLD_KEYS,
    freshPlayer: freshPlayer, freshWorld: freshWorld, normPlayer: normPlayer, normWorld: normWorld, pick: pick,
    countries: countries, fmtFull: fmtFull, dayKey: dayKey, evaluate: evaluate, findItem: findItem, freeSlots: freeSlots,
    eventNow: eventNow, eventTitle: eventTitle, costOf: costOf, noticeNow: noticeNow, dailyStatus: dailyStatus,
    buyersFor: buyersFor, buyersToday: buyersToday, buyerState: buyerState, buyerAccepts: buyerAccepts, buyerPrice: buyerPrice,
    upgChance: upgChance, upgChanceFor: upgChanceFor, prizeFor: prizeFor, tierForPrice: tierForPrice, money: money, plural: plural, fmtMult: fmtMult,
    ops: OPS, adminAct: adminAct, worldOp: worldOp, gift: gift, GIFT_MAX: GIFT_MAX, playerStats: playerStats, achList: achList, achReady: achReady
  };
});
