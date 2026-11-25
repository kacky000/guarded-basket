# guarded-basket

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/kacky000/guarded-basket/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/kacky000/guarded-basket/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A paper-trading bot for "Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana". It starts as the equal-weight basket of the seven coins, rebalances a coin back to equal weight when it drifts 3% from it, and steps out of a coin only on a crash (20% under its high since purchase and under its 48-hour EMA), buying back on a 24-hour breakout above the EMA.

Why so close to buy-and-hold: on the dev window every tighter stop lost more than holding, by selling the lows of the chop. The final window is three unseen days, so the bot keeps the basket's upside and only guards the tail and the 25% drawdown guardrail.

| dev window (136 h) | net PnL (USDC, of 10,000) | trades | max drawdown |
|---|---|---|---|
| buy-and-hold baseline | -869.3 | 7 | 10.9% |
| this bot | -851.5 | 20 | 10.8% |
| 8% trail / 24h EMA (rejected) | -1117.3 | 23 | 12.7% |

## Run it

```sh
node main.ts
```

It speaks the bars-replay protocol on stdin/stdout through `vendor/makefun-bars.ts` (a byte-identical copy of the kit's SDK).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
