import fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import moment from 'moment';
import * as math from 'mathjs';
import {
  Candle,
  Pair,
  TradeResult,
  TrailingStopUpdate,
  MatchingCandle,
  BalanceUpdate,
  TradeExit,
} from './interfaces';
import config from './config';

interface TriggerLevel {
  trigger: number;
  stopLoss: number;
  triggered: boolean;
  hit: boolean;
}

export class Backtester {
  private candles: Candle[] = [];
  private matchingCandles: MatchingCandle[] = [];
  private symbol: string;
  private currentBalance: number;
  private balanceHistory: BalanceUpdate[] = [];

  constructor(symbol: string) {
    this.symbol = symbol;
    this.currentBalance = config.account.initialBalance;

    if (!config.pairs[symbol]?.enabled) {
      throw new Error(`Trading pair ${symbol} is not enabled in config`);
    }
  }

  async loadData(csvFilePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (row) => {
          const candle: Candle = {
            openTime: parseInt(row.open_time),
            open: parseFloat(row.open),
            high: parseFloat(row.high),
            low: parseFloat(row.low),
            close: parseFloat(row.close),
            volume: parseFloat(row.volume),
            closeTime: parseInt(row.close_time),
          };
          this.candles.push(candle);
        })
        .on('end', () => {
          const fileName = path.basename(csvFilePath);
          console.log(`Loaded ${this.candles.length} candles from ${fileName}`);
          resolve();
        })
        .on('error', reject);
    });
  }

  private async checkThresholdCrossing(
    startIndex: number,
    legendCandle: {
      timestamp: string;
      close: number;
      upward_movementThreshold: number;
      downward_movementThreshold: number;
    }
  ): Promise<{
    direction: 'LONG' | 'SHORT' | 'NONE';
    crossed_at: string;
    entry_price: number;
    candles_until_cross: number;
  }> {
    // Look ahead up to 30 days (720 hours)
    const lookForward = Math.min(720, this.candles.length - startIndex);

    for (let i = 1; i <= lookForward; i++) {
      if (startIndex + i >= this.candles.length) {
        return {
          direction: 'NONE',
          crossed_at: '',
          entry_price: 0,
          candles_until_cross: 0,
        };
      }

      const candle = this.candles[startIndex + i];

      // Check which threshold is crossed first
      if (candle.high > legendCandle.upward_movementThreshold) {
        return {
          direction: 'LONG',
          crossed_at: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
          entry_price: legendCandle.upward_movementThreshold,
          candles_until_cross: i,
        };
      }

      if (candle.low < legendCandle.downward_movementThreshold) {
        return {
          direction: 'SHORT',
          crossed_at: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
          entry_price: legendCandle.downward_movementThreshold,
          candles_until_cross: i,
        };
      }
    }

    return {
      direction: 'NONE',
      crossed_at: '',
      entry_price: 0,
      candles_until_cross: 0,
    };
  }

  private calculateTriggerLevels(
    entryPrice: number,
    side: 'LONG' | 'SHORT',
    dynamicThreshold: number
  ): TriggerLevel[] {
    const levels: TriggerLevel[] = [];
    const thresholdMultiplier = dynamicThreshold / 100;

    // Calculate 20 trigger levels
    for (let i = 1; i <= 20; i++) {
      if (side === 'LONG') {
        // For LONG positions
        const trigger = entryPrice * (1 + thresholdMultiplier * i);
        const stopLoss = entryPrice * (1 + thresholdMultiplier * (i - 1));

        levels.push({
          trigger,
          stopLoss,
          triggered: false,
          hit: false,
        });
      } else {
        // For SHORT positions
        const trigger = entryPrice * (1 - thresholdMultiplier * i);
        const stopLoss = entryPrice * (1 - thresholdMultiplier * (i - 1));

        levels.push({
          trigger,
          stopLoss,
          triggered: false,
          hit: false,
        });
      }
    }

    return levels;
  }

  private async checkTradeOutcome(
    startIndex: number,
    entry: {
      price: number;
      side: 'LONG' | 'SHORT';
      size: number;
      dynamicThreshold: number;
    }
  ): Promise<TradeExit | null> {
    // Calculate trigger levels using dynamicThreshold
    const triggerLevels = this.calculateTriggerLevels(
      entry.price,
      entry.side,
      entry.dynamicThreshold
    );

    // Initial stop loss using dynamicThreshold
    let currentStopLoss = entry.side === 'LONG'
      ? entry.price * (1 - entry.dynamicThreshold / 100)
      : entry.price * (1 + entry.dynamicThreshold / 100);

    let currentTriggerIndex = 0;
    let nextTriggerLevel = triggerLevels[currentTriggerIndex];

    const trailingHistory: TrailingStopUpdate[] = [
      {
        price: currentStopLoss,
        time: moment(this.candles[startIndex].openTime).format(
          'YYYY-MM-DD HH:mm:ss'
        ),
        type: 'INITIAL',
        market_price: entry.price,
        profit_at_update: 0,
      },
    ];

    // For each candle, check both stop loss and next trigger
    for (let i = 1; i <= config.trade.maxLookForwardCandles; i++) {
      if (startIndex + i >= this.candles.length) return null;
      const candle = this.candles[startIndex + i];

      if (entry.side === 'LONG') {
        // For LONG positions:
        // 1. Check if stop loss is hit (using low price for worst case)
        if (candle.low <= currentStopLoss) {
          console.log(`
🛑 STOP LOSS HIT (LONG):
Time: ${moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss')}
Stop Loss: ${currentStopLoss.toFixed(2)}
Hit Price (Low): ${candle.low.toFixed(2)}
Candle Range: ${candle.low.toFixed(2)} - ${candle.high.toFixed(2)}
                  `);

          trailingHistory.push({
            price: currentStopLoss,
            time: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
            type: 'HIT',
            market_price: candle.low,  // Using low price that triggered stop loss
            profit_at_update: ((currentStopLoss - entry.price) / entry.price) * 100
          });

          return {
            price: currentStopLoss,
            time: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
            type: 'TRAILING_STOP',
            candles_until_exit: i,
            trailing_stops: trailingHistory
          };
        }

        // 2. Check if new trigger is hit (using high price for best case)
        if (currentTriggerIndex < triggerLevels.length && 
            candle.high >= nextTriggerLevel.trigger) {
          console.log(`
🎯 TRIGGER ${currentTriggerIndex + 1} HIT (LONG):
Time: ${moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss')}
Trigger Level: ${nextTriggerLevel.trigger.toFixed(2)}
Hit Price (High): ${candle.high.toFixed(2)}
Candle Range: ${candle.low.toFixed(2)} - ${candle.high.toFixed(2)}
                  `);

          currentStopLoss = nextTriggerLevel.stopLoss;
          trailingHistory.push({
            price: currentStopLoss,
            time: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
            type: 'TRAIL_UP',
            market_price: candle.high,  // Using high price that triggered update
            profit_at_update: ((candle.high - entry.price) / entry.price) * 100
          });

          currentTriggerIndex++;
          nextTriggerLevel = triggerLevels[currentTriggerIndex];
        }
      } else {
        // For SHORT positions:
        // 1. Check if stop loss is hit (using high price for worst case)
        if (candle.high >= currentStopLoss) {
          console.log(`
🛑 STOP LOSS HIT (SHORT):
Time: ${moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss')}
Stop Loss: ${currentStopLoss.toFixed(2)}
Hit Price (High): ${candle.high.toFixed(2)}
Candle Range: ${candle.low.toFixed(2)} - ${candle.high.toFixed(2)}
                  `);

          trailingHistory.push({
            price: currentStopLoss,
            time: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
            type: 'HIT',
            market_price: candle.high,  // Using high price that triggered stop loss
            profit_at_update: ((entry.price - currentStopLoss) / entry.price) * 100
          });

          return {
            price: currentStopLoss,
            time: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
            type: 'TRAILING_STOP',
            candles_until_exit: i,
            trailing_stops: trailingHistory
          };
        }

        // 2. Check if new trigger is hit (using low price for best case)
        if (currentTriggerIndex < triggerLevels.length && 
            candle.low <= nextTriggerLevel.trigger) {
          console.log(`
🎯 TRIGGER ${currentTriggerIndex + 1} HIT (SHORT):
Time: ${moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss')}
Trigger Level: ${nextTriggerLevel.trigger.toFixed(2)}
Hit Price (Low): ${candle.low.toFixed(2)}
Candle Range: ${candle.low.toFixed(2)} - ${candle.high.toFixed(2)}
                  `);

          currentStopLoss = nextTriggerLevel.stopLoss;
          trailingHistory.push({
            price: currentStopLoss,
            time: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
            type: 'TRAIL_DOWN',
            market_price: candle.low,  // Using low price that triggered update
            profit_at_update: ((entry.price - candle.low) / entry.price) * 100
          });

          currentTriggerIndex++;
          nextTriggerLevel = triggerLevels[currentTriggerIndex];
        }
      }
    }

    return null;
  }

  private calculatePnL(
    entry: number,
    exit: number,
    side: 'LONG' | 'SHORT',
    size: number
  ): {
    pnl: number;
    pnl_percentage: number;
  } {
    const pnl = side === 'LONG' ? exit - entry : entry - exit;

    const pnl_percentage = (pnl / entry) * 100;

    return { pnl, pnl_percentage };
  }

  private updateBalanceAfterTrade(trade: TradeResult): void {
    this.currentBalance += trade.pnl;

    this.balanceHistory.push({
      timestamp: trade.exit.time,
      balance: this.currentBalance,
      trade_pnl: trade.pnl,
      trade_type: trade.exit.type,
    });
  }

  private async processCandle(
    currentCandle: Candle,
    lookbackCandles: Candle[],
    currentIndex: number
  ): Promise<void> {
    // Use config values
    const previousCandles = lookbackCandles.slice(
      -config.lookbackPeriod.candles
    );
    const currentDiff =
      (math.abs(currentCandle.close - currentCandle.open) /
        currentCandle.open) *
      100;

    const previousDiffs = previousCandles.map(
      (candle) => math.abs((candle.close - candle.open) / candle.open) * 100
    );

    const averageDiff = math.mean(previousDiffs);
    const dynamicThreshold = config.lookbackPeriod.threshold * averageDiff;

    console.log(`
🔍 Checking candle at ${moment(currentCandle.openTime).format(
      'YYYY-MM-DD HH:mm:ss'
    )}
Open: ${currentCandle.open} | Close: ${currentCandle.close}
Movement: ${currentDiff.toFixed(2)}%
Previous ${config.lookbackPeriod.candles} candles avg: ${averageDiff.toFixed(
      2
    )}%
Required: >${dynamicThreshold.toFixed(2)}%`);
    if (currentDiff > dynamicThreshold) {
      // This is a legendCandle
      const thresholdPercentage = dynamicThreshold / 100;
      const legendCandle = {
        timestamp: moment(currentCandle.openTime).format('YYYY-MM-DD HH:mm:ss'),
        close: currentCandle.close,
        upward_movementThreshold:
          currentCandle.close * (1 + thresholdPercentage),
        downward_movementThreshold:
          currentCandle.close * (1 - thresholdPercentage),
      };

      console.log(`✅ LEGEND CANDLE FOUND!
            Time: ${legendCandle.timestamp}
            Close Price: ${legendCandle.close}
            Movement: ${currentDiff.toFixed(2)}%
            Dynamic Threshold: ${dynamicThreshold.toFixed(2)}%
            
            ENTRY LEVELS:
            LONG → Above ${legendCandle.upward_movementThreshold.toFixed(
              2
            )} USDT
            SHORT → Below ${legendCandle.downward_movementThreshold.toFixed(
              2
            )} USDT`);

      // Check which threshold is crossed first
      const threshold_crossed = await this.checkThresholdCrossing(
        currentIndex,
        legendCandle
      );

      if (threshold_crossed.direction !== 'NONE') {
        // Calculate position size based on current balance
        const tradeSize = this.calculateTradeSize(
          threshold_crossed.entry_price
        );

        // Check trade outcome with actual position size
        const exit = await this.checkTradeOutcome(
          currentIndex + threshold_crossed.candles_until_cross,
          {
            price: threshold_crossed.entry_price,
            side: threshold_crossed.direction,
            size: tradeSize,
            dynamicThreshold: dynamicThreshold
          }
        );

        if (exit) {
          const { pnl, pnl_percentage } = this.calculatePnL(
            threshold_crossed.entry_price,
            exit.price,
            threshold_crossed.direction,
            tradeSize
          );

          // Update balance
          this.currentBalance += pnl;

          const tradeResult: TradeResult & { balance_after_trade: number } = {
            entry: {
              price: threshold_crossed.entry_price,
              time: threshold_crossed.crossed_at,
              side: threshold_crossed.direction,
              candles_until_entry: threshold_crossed.candles_until_cross,
            },
            exit: {
              price: exit.price,
              time: exit.time,
              type: exit.type,
              candles_until_exit: exit.candles_until_exit,
              trailing_stops: exit.trailing_stops,
            },
            pnl,
            pnl_percentage,
            trailing_stop_history: exit.trailing_stops,
            max_profit_reached: exit.price - threshold_crossed.entry_price,
            max_profit_percentage:
              ((exit.price - threshold_crossed.entry_price) /
                threshold_crossed.entry_price) *
              100,
            final_profit: exit.price - threshold_crossed.entry_price,
            final_profit_percentage:
              ((exit.price - threshold_crossed.entry_price) /
                threshold_crossed.entry_price) *
              100,
            trailing_metrics: {
              total_trails: exit.trailing_stops.length - 1,
              average_trail_distance:
                exit.trailing_stops.reduce(
                  (
                    sum: number,
                    update: TrailingStopUpdate,
                    idx: number,
                    arr: TrailingStopUpdate[]
                  ) =>
                    idx > 0
                      ? sum + Math.abs(update.price - arr[idx - 1].price)
                      : sum,
                  0
                ) /
                (exit.trailing_stops.length - 1),
              largest_trail: Math.max(
                ...exit.trailing_stops
                  .slice(1)
                  .map((update) =>
                    Math.abs(update.price - exit.trailing_stops[0].price)
                  )
              ),
              profit_saved_by_trailing:
                ((exit.price - threshold_crossed.entry_price) /
                  threshold_crossed.entry_price) *
                100,
            },
            balance_after_trade: this.currentBalance,
          };

          console.log(`
                TRADE COMPLETED:
                Entry: ${tradeResult.entry.side} @ ${
            tradeResult.entry.price
          } (${tradeResult.entry.time})
                Exit: ${tradeResult.exit.type} @ ${tradeResult.exit.price} (${
            tradeResult.exit.time
          })
                PnL: ${tradeResult.pnl.toFixed(
                  2
                )} USDT (${tradeResult.pnl_percentage.toFixed(2)}%)
                Balance: ${this.currentBalance.toFixed(2)} USDT
                `);

          this.matchingCandles.push({
            timestamp: legendCandle.timestamp,
            open: currentCandle.open,
            close: currentCandle.close,
            movement: currentDiff,
            dynamicThreshold: dynamicThreshold,
            averageMovement: averageDiff,
            numPreviousCandles: config.lookbackPeriod.candles,
            upward_movementThreshold: legendCandle.upward_movementThreshold,
            downward_movementThreshold: legendCandle.downward_movementThreshold,
            entry_instructions: {
              long: `Enter LONG if price crosses above ${legendCandle.upward_movementThreshold.toFixed(
                2
              )} USDT`,
              short: `Enter SHORT if price crosses below ${legendCandle.downward_movementThreshold.toFixed(
                2
              )} USDT`,
            },
            threshold_crossed,
            trade_result: tradeResult,
          });
        }
      }
    } else {
      console.log(
        `❌ Failed: Movement (${currentDiff.toFixed(
          2
        )}%) <= Dynamic Threshold (${dynamicThreshold.toFixed(2)}%)`
      );
      console.log('-------------------');
    }
  }

  async findMatchingCandles(): Promise<void> {
    const lookbackPeriod = config.lookbackPeriod.candles + 10;

    for (let i = lookbackPeriod; i < this.candles.length; i++) {
      const currentCandle = this.candles[i];
      const lookbackCandles = this.candles.slice(i - lookbackPeriod, i);
      await this.processCandle(currentCandle, lookbackCandles, i);
    }

    // Calculate trade statistics with balance tracking
    const resultsFile = path.join(__dirname, '../matching_candles.json');
    const balanceHistory = this.matchingCandles
      .filter((c) => c.trade_result !== null)
      .map((c) => ({
        timestamp: c.timestamp,
        balance_before:
          c.trade_result!.balance_after_trade - c.trade_result!.pnl,
        balance_after: c.trade_result!.balance_after_trade,
        pnl: c.trade_result!.pnl,
        trade_type: c.trade_result!.exit.type,
        trade_side: c.trade_result!.entry.side,
      }));

    const tradeDetails = this.matchingCandles.map((candle) => ({
      timestamp: candle.timestamp,
      entry: {
        price: candle.trade_result?.entry.price,
        time: candle.trade_result?.entry.time,
        side: candle.trade_result?.entry.side,
        formatted_price: `${candle.trade_result?.entry.price.toFixed(2)} USDT`
      },
      trailing_details: candle.trade_result ? {
        initial_stop: {
          price: candle.trade_result.trailing_stop_history[0].price.toFixed(2),
          time: candle.trade_result.trailing_stop_history[0].time,
          distance_from_entry: `${(Math.abs(candle.trade_result.trailing_stop_history[0].price - candle.trade_result.entry.price)).toFixed(2)} USDT`,
          percentage_from_entry: `${((Math.abs(candle.trade_result.trailing_stop_history[0].price - candle.trade_result.entry.price) / candle.trade_result.entry.price) * 100).toFixed(2)}%`
        },
        trails: candle.trade_result.trailing_stop_history.slice(1, -1).map((update, index) => ({
          trail_number: index + 1,
          time: update.time,
          market_price: update.market_price.toFixed(2),
          old_stop_loss: update.price.toFixed(2),
          new_stop_loss: candle.trade_result!.trailing_stop_history[index + 2].price.toFixed(2),
          stop_loss_movement: `${(Math.abs(candle.trade_result!.trailing_stop_history[index + 2].price - update.price)).toFixed(2)} USDT`,
          profit_at_trail: `${update.profit_at_update.toFixed(2)}%`,
          price_movement_from_entry: `${(Math.abs(update.market_price - candle.trade_result!.entry.price)).toFixed(2)} USDT`,
          price_movement_percentage: `${((Math.abs(update.market_price - candle.trade_result!.entry.price) / candle.trade_result!.entry.price) * 100).toFixed(2)}%`,
          trail_details: {
            triggered_by: update.type === 'TRAIL_UP' ? 'Price moved up' : 'Price moved down',
            trail_distance: `${(Math.abs(candle.trade_result!.trailing_stop_history[index + 2].price - update.price)).toFixed(2)} USDT`,
            trail_percentage: `${((Math.abs(candle.trade_result!.trailing_stop_history[index + 2].price - update.price) / update.price) * 100).toFixed(2)}%`
          }
        })),
        exit_details: {
          time: candle.trade_result.exit.time,
          final_stop_loss: candle.trade_result.exit.price.toFixed(2),
          market_price_at_exit: candle.trade_result.trailing_stop_history[candle.trade_result.trailing_stop_history.length - 1].market_price.toFixed(2),
          total_trails_before_exit: candle.trade_result.trailing_metrics.total_trails,
          max_profit_seen: `${candle.trade_result.max_profit_percentage.toFixed(2)}%`,
          final_profit: `${candle.trade_result.pnl.toFixed(2)} USDT (${candle.trade_result.pnl_percentage.toFixed(2)}%)`,
          trail_efficiency: `${candle.trade_result.trailing_metrics.profit_saved_by_trailing.toFixed(2)}%`,
          exit_reason: candle.trade_result.trailing_stop_history[candle.trade_result.trailing_stop_history.length - 1].type === 'HIT' ? 'Stop Loss Hit' : 'Market Reversed'
        },
        trail_summary: {
          total_trails: candle.trade_result.trailing_metrics.total_trails,
          average_trail_distance: candle.trade_result.trailing_metrics.average_trail_distance.toFixed(2),
          largest_trail: candle.trade_result.trailing_metrics.largest_trail.toFixed(2),
          profit_saved_by_trailing: candle.trade_result.trailing_metrics.profit_saved_by_trailing.toFixed(2),
          total_price_movement: `${(Math.abs(candle.trade_result.trailing_stop_history[candle.trade_result.trailing_stop_history.length - 1].market_price - candle.trade_result.entry.price)).toFixed(2)} USDT`,
          total_stop_loss_movement: `${(Math.abs(candle.trade_result.exit.price - candle.trade_result.trailing_stop_history[0].price)).toFixed(2)} USDT`
        }
      } : null,
      balance_after_trade: candle.trade_result?.balance_after_trade
    }));

    await fs.promises.writeFile(
      resultsFile,
      JSON.stringify(
        {
          config: {
            symbol: this.symbol,
            threshold: config.lookbackPeriod.threshold,
            num_previous_candles: config.lookbackPeriod.candles,
            initial_balance: config.account.initialBalance,
          },
          trade_performance: {
            total_trades: this.matchingCandles.length,
            profitable_trades: this.matchingCandles.filter(
              c => c.trade_result && c.trade_result.pnl > 0
            ).length,
            unprofitable_trades: this.matchingCandles.filter(
              c => c.trade_result && c.trade_result.pnl <= 0
            ).length,
            win_rate: ((this.matchingCandles.filter(
              c => c.trade_result && c.trade_result.pnl > 0
            ).length / this.matchingCandles.length) * 100).toFixed(2) + '%',
            by_direction: {
              long: {
                total_trades: this.matchingCandles.filter(
                  c => c.trade_result?.entry.side === 'LONG'
                ).length,
                profitable_trades: this.matchingCandles.filter(
                  c => c.trade_result?.entry.side === 'LONG' && c.trade_result.pnl > 0
                ).length,
                total_pnl: this.matchingCandles
                  .filter(c => c.trade_result?.entry.side === 'LONG')
                  .reduce((sum, trade) => sum + (trade.trade_result?.pnl || 0), 0)
                  .toFixed(2) + ' USDT'
              },
              short: {
                // Similar structure for short trades
              }
            }
          },
          detailed_trades: tradeDetails,
        },
        null,
        2
      )
    );

    // Print summary to console
    console.log('\nTrade Performance Summary:');
    console.log('========================');
    console.log(`Total Trades: ${this.matchingCandles.length}`);
    console.log(
      `Total PnL: ${this.matchingCandles
        .reduce((sum, trade) => sum + (trade.trade_result?.pnl || 0), 0)
        .toFixed(2)} USDT (${(
        (this.matchingCandles.reduce(
          (sum, trade) => sum + (trade.trade_result?.pnl || 0),
          0
        ) /
          this.currentBalance) *
        100
      ).toFixed(2)}%)`
    );
    console.log(
      `Average PnL per Trade: ${(
        this.matchingCandles.reduce(
          (sum, trade) => sum + (trade.trade_result?.pnl || 0),
          0
        ) / this.matchingCandles.length
      ).toFixed(2)} USDT (${(
        (this.matchingCandles.reduce(
          (sum, trade) => sum + (trade.trade_result?.pnl || 0),
          0
        ) /
          this.matchingCandles.length /
          this.currentBalance) *
        100
      ).toFixed(2)}%)`
    );

    console.log('\nOutcomes by Direction:');
    console.log('LONG Trades:');
    console.log(
      `- Total: ${
        this.matchingCandles.filter(
          (c) => c.trade_result?.entry.side === 'LONG'
        ).length
      }`
    );

    // Count profitable trades instead of takeprofit/stoploss
    console.log(
      `- Profitable Trades: ${
        this.matchingCandles.filter(
          (c) =>
            c.trade_result?.entry.side === 'LONG' &&
            c.trade_result.pnl > 0
        ).length
      } (${(
        (this.matchingCandles.filter(
          (c) =>
            c.trade_result?.entry.side === 'LONG' &&
            c.trade_result.pnl > 0
        ).length /
          this.matchingCandles.filter(
            (c) => c.trade_result?.entry.side === 'LONG'
          ).length) *
        100
      ).toFixed(2)}%)`
    );

    console.log(
      `- Unprofitable Trades: ${
        this.matchingCandles.filter(
          (c) =>
            c.trade_result?.entry.side === 'LONG' &&
            c.trade_result.pnl <= 0
        ).length
      } (${(
        (this.matchingCandles.filter(
          (c) =>
            c.trade_result?.entry.side === 'LONG' &&
            c.trade_result.pnl <= 0
        ).length /
          this.matchingCandles.filter(
            (c) => c.trade_result?.entry.side === 'LONG'
          ).length) *
        100
      ).toFixed(2)}%)`
    );

    console.log(
      `- PnL: ${this.matchingCandles
        .filter((c) => c.trade_result?.entry.side === 'LONG')
        .reduce((sum, trade) => sum + (trade.trade_result?.pnl || 0), 0)
        .toFixed(2)} USDT`
    );

    console.log('\nSHORT Trades:');
    console.log(
      `- Total: ${
        this.matchingCandles.filter(
          (c) => c.trade_result?.entry.side === 'SHORT'
        ).length
      }`
    );

    // Count profitable trades instead of takeprofit/stoploss
    console.log(
      `- Profitable Trades: ${
        this.matchingCandles.filter(
          (c) =>
            c.trade_result?.entry.side === 'SHORT' &&
            c.trade_result.pnl > 0
        ).length
      } (${(
        (this.matchingCandles.filter(
          (c) =>
            c.trade_result?.entry.side === 'SHORT' &&
            c.trade_result.pnl > 0
        ).length /
          this.matchingCandles.filter(
            (c) => c.trade_result?.entry.side === 'SHORT'
          ).length) *
        100
      ).toFixed(2)}%)`
    );

    console.log(
      `- Unprofitable Trades: ${
        this.matchingCandles.filter(
          (c) =>
            c.trade_result?.entry.side === 'SHORT' &&
            c.trade_result.pnl <= 0
        ).length
      } (${(
        (this.matchingCandles.filter(
          (c) =>
            c.trade_result?.entry.side === 'SHORT' &&
            c.trade_result.pnl <= 0
        ).length /
          this.matchingCandles.filter(
            (c) => c.trade_result?.entry.side === 'SHORT'
          ).length) *
        100
      ).toFixed(2)}%)`
    );

    console.log(
      `- PnL: ${this.matchingCandles
        .filter((c) => c.trade_result?.entry.side === 'SHORT')
        .reduce((sum, trade) => sum + (trade.trade_result?.pnl || 0), 0)
        .toFixed(2)} USDT`
    );

    console.log(`\nResults saved to ${resultsFile}`);

    // Update console output
    console.log('\nAccount Performance:');
    console.log(
      `Initial Balance: ${config.account.initialBalance.toFixed(2)} USDT`
    );
    console.log(`Final Balance: ${this.currentBalance.toFixed(2)} USDT`);
    console.log(
      `Total Return: ${(
        ((this.currentBalance - config.account.initialBalance) /
          config.account.initialBalance) *
        100
      ).toFixed(2)}%`
    );
    console.log(
      `Absolute Return: ${(
        this.currentBalance - config.account.initialBalance
      ).toFixed(2)} USDT`
    );
  }

  private calculateTradeSize(entryPrice: number): number {
    const positionSize =
      (this.currentBalance * config.account.positionSizePercent) / 100;
    return positionSize / entryPrice; // Convert USDT to token quantity
  }
}
