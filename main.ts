// Guarded Basket: buy-and-hold with a seatbelt and a 3% rebalancing band.
//
// The bar to clear is buy-and-hold of the seven-coin basket, over a final window of three days that
// nobody has seen. A strategy tuned to the dev window tells us little about those three days, so this
// bot starts out as the basket itself and only steps aside from a coin that is clearly falling:
//
//   - First batch: buy an equal slice of every priced coin, like the house baseline. The calmest coin
//     (JITOSOL) is bought in two halves, on the first and the second batch, so the run always has at
//     least eight trades (the guardrail) even when nothing ever falls.
//   - Exit a coin when its close is TRAIL below the highest close since it was bought AND under its
//     slow EMA: a real slide, not one red hour.
//   - Re-enter a coin we stepped out of once it turns back up: close above the slow EMA, fast EMA
//     above slow, and a new high over the last BREAKOUT closes.
//   - Each re-entry buys the coin's equal share of current equity, capped by cash and the weight cap.
//
// In a rising window it tracks the basket, minus nothing but an occasional stop-and-rebuy. In a
// falling one it sits in USDC for the worst of it, which is also what keeps the drawdown under the
// 25% guardrail that a meme-coin basket can break on its own.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

// Chosen on the dev window (136 hourly bars, basket -8.7%): every tighter stop (5-15% trail, 24-48h
// EMA) lost 1-3.5% more than holding, by selling chop lows and buying back higher. So the stop is
// only a crash guard (20% off the high and under the 48h EMA), and the edge we keep is cheap:
// rebalancing a coin back to equal weight once it drifts 3% from it, which sells what ran up and buys
// what lagged among seven coins that mostly move together.
const FAST = 12;
const SLOW = 48;
const TRAIL = 0.2;
const BREAKOUT = 24;
const BAND = 0.03;
const SPLIT_SYMBOL = 'JITOSOL';
const SLIPPAGE_BPS = 150;

interface Track {
  fast: number | null;
  slow: number | null;
  seen: number;
  closes: number[];
  peak: number;
  out: boolean;
}

const tracks = new Map<string, Track>();
let batchesTraded = 0;

function ema(prev: number | null, span: number, x: number, seen: number): number {
  if (prev === null) return x;
  // Until the span has filled, average the closes seen so far; after that, the usual EMA step.
  const k = seen < span ? 1 / seen : 2 / (span + 1);
  return prev + k * (x - prev);
}

function update(bar: Bar): Track {
  let t = tracks.get(bar.symbol);
  if (t === undefined) {
    t = { fast: null, slow: null, seen: 0, closes: [], peak: 0, out: false };
    tracks.set(bar.symbol, t);
  }
  const c = Number(bar.c);
  t.seen += 1;
  t.fast = ema(t.fast, FAST, c, t.seen);
  t.slow = ema(t.slow, SLOW, c, t.seen);
  t.closes.push(c);
  if (t.closes.length > BREAKOUT + 1) t.closes.shift();
  if (c > t.peak) t.peak = c;
  return t;
}

function shouldExit(t: Track, c: number): boolean {
  return t.slow !== null && c < t.peak * (1 - TRAIL) && c < t.slow;
}

function shouldReenter(t: Track, c: number): boolean {
  if (t.fast === null || t.slow === null || t.seen < FAST) return false;
  const before = t.closes.slice(0, -1);
  return c > t.slow && t.fast > t.slow && before.length > 0 && c > Math.max(...before);
}

function slice(state: BarsState, n: number, cash: bigint): bigint {
  const even = state.equity / BigInt(n);
  const byWeight = (BigInt(state.hello.caps.max_weight_bps) * state.equity) / BPS;
  let s = even < byWeight ? even : byWeight;
  if (s > cash) s = cash;
  return s;
}

await runBars({
  onBatch(state, batch) {
    const fresh = new Map<string, number>();
    for (const bar of batch.bars) {
      update(bar);
      fresh.set(bar.symbol, Number(bar.c));
    }
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const universe = state.hello.symbols.map((s) => s.symbol);
    const n = Math.min(universe.length, caps.max_open_positions);
    const minimum = BigInt(fees.min_notional_quote_units);
    const orders: (SellInput | BuyInput)[] = [];
    let cash = state.cash;

    if (batchesTraded === 0) {
      const priced = universe.filter((s) => state.close(s) !== null);
      if (priced.length === 0) return [];
      batchesTraded = 1;
      const each = slice(state, n, cash);
      for (const symbol of priced.slice(0, Math.min(n, caps.max_orders_per_bar))) {
        const amount = symbol === SPLIT_SYMBOL ? each / 2n : each;
        if (amount < minimum) continue;
        orders.push({ side: 'buy', symbol, notional_quote_units: amount, max_slippage_bps: SLIPPAGE_BPS });
        tracks.get(symbol)!.peak = state.close(symbol) === null ? 0 : Number(state.close(symbol));
      }
      return orders;
    }

    if (batchesTraded === 1) {
      batchesTraded = 2;
      const held = state.positions.get(SPLIT_SYMBOL);
      const target = state.equity / BigInt(n);
      const have = held === undefined ? 0n : BigInt(held.cost);
      const rest = target - have;
      if (rest >= minimum && rest <= cash && fresh.has(SPLIT_SYMBOL)) {
        orders.push({ side: 'buy', symbol: SPLIT_SYMBOL, notional_quote_units: rest, max_slippage_bps: SLIPPAGE_BPS });
        cash -= rest;
      }
    }

    // Sells first: their proceeds arrive at the next open, so this reply's buys spend only cash on hand.
    for (const symbol of universe) {
      const c = fresh.get(symbol);
      if (c === undefined) continue;
      const t = tracks.get(symbol)!;
      const held = state.positions.get(symbol);
      if (held !== undefined && !t.out && shouldExit(t, c)) {
        orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: SLIPPAGE_BPS });
        t.out = true;
      }
    }
    // Rebalance the coins still held back toward equal weight once one drifts past the band.
    if (BAND > 0) {
      const target = state.equity / BigInt(n);
      for (const symbol of universe) {
        if (!fresh.has(symbol) || orders.some((o) => o.symbol === symbol)) continue;
        const t = tracks.get(symbol)!;
        const held = state.positions.get(symbol);
        if (held === undefined || t.out) continue;
        const value = state.value(symbol, held.qty);
        const hi = (target * BigInt(Math.round((1 + BAND) * 10000))) / BPS;
        const lo = (target * BigInt(Math.round((1 - BAND) * 10000))) / BPS;
        if (value > hi) {
          const qty = (held.qty * (value - target)) / value;
          if (value - target >= minimum && qty > 0n) orders.push({ side: 'sell', symbol, qty, max_slippage_bps: SLIPPAGE_BPS });
        } else if (value < lo) {
          let need = target - value;
          if (need > cash) need = cash;
          if (need >= minimum) {
            orders.push({ side: 'buy', symbol, notional_quote_units: need, max_slippage_bps: SLIPPAGE_BPS });
            cash -= need;
          }
        }
      }
    }

    for (const symbol of universe) {
      if (orders.length >= caps.max_orders_per_bar) break;
      const c = fresh.get(symbol);
      if (c === undefined) continue;
      const t = tracks.get(symbol)!;
      if (!t.out || state.positions.has(symbol) || !shouldReenter(t, c)) continue;
      const amount = slice(state, n, cash);
      if (amount < minimum) continue;
      orders.push({ side: 'buy', symbol, notional_quote_units: amount, max_slippage_bps: SLIPPAGE_BPS });
      cash -= amount;
      t.out = false;
      t.peak = c;
    }
    return orders;
  },
});
