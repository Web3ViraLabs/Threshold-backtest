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
  TradeDetailsResult,
} from './interfaces';
import config, { TradingConfig } from './config';

interface TriggerLevel {
  trigger: number;
  stopLoss: number;
  triggered: boolean;
  hit: boolean;
}

export class Backtester {
  private candles: Candle[] = [];
  private matchingCandles: MatchingCandle[] = [];
  private currentBalance: number;
  private balanceHistory: BalanceUpdate[] = [];

  constructor(
    private symbol: string,
    private runConfig: TradingConfig = config
  ) {
    this.currentBalance = runConfig.account.initialBalance;
  }

  async loadData(csvFilePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTimestamp = new Date(
        this.runConfig.dataFetch.startDate.year,
        this.runConfig.dataFetch.startDate.month - 1
      ).getTime();

      const endTimestamp = this.runConfig.dataFetch.endDate 
        ? new Date(
            this.runConfig.dataFetch.endDate.year,
            this.runConfig.dataFetch.endDate.month - 1
          ).getTime()
        : new Date().getTime();

      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (row) => {
          const candleTimestamp = parseInt(row.open_time);
          
          // Only include candles within the specified date range
          if (candleTimestamp >= startTimestamp && candleTimestamp <= endTimestamp) {
            const candle: Candle = {
              openTime: candleTimestamp,
              open: parseFloat(row.open),
              high: parseFloat(row.high),
              low: parseFloat(row.low),
              close: parseFloat(row.close),
              volume: parseFloat(row.volume),
              closeTime: parseInt(row.close_time),
            };
            this.candles.push(candle);
          }
        })
        .on('end', () => {
          const fileName = path.basename(csvFilePath);
          console.log(`Loaded ${this.candles.length} candles from ${fileName} within date range ${
            moment(startTimestamp).format('YYYY-MM-DD')} to ${
            moment(endTimestamp).format('YYYY-MM-DD')
          }`);
          resolve();
        })
        .on('error', reject);
    });
  }

  private async processCandle(
    currentCandle: Candle,
    lookbackCandles: Candle[],
    currentIndex: number
  ): Promise<void> {
    // Get previous candles for average calculation
    const previousCandles = lookbackCandles.slice(
      -this.runConfig.strategy.lookbackPeriod.candles
    );

    // Calculate current candle's movement percentage
    const currentDiff = (Math.abs(currentCandle.close - currentCandle.open) / 
      currentCandle.open) * 100;

    // Calculate average movement of previous candles
    const previousDiffs = previousCandles.map(
      (candle) => Math.abs((candle.close - candle.open) / candle.open) * 100
    );
    const averageDiff = math.mean(previousDiffs);
    const dynamicThreshold = this.runConfig.strategy.lookbackPeriod.threshold * averageDiff;

    console.log(`
🔍 Checking candle at ${moment(currentCandle.openTime).format('YYYY-MM-DD HH:mm:ss')}
Movement: ${currentDiff.toFixed(2)}%
Average Movement: ${averageDiff.toFixed(2)}%
Dynamic Threshold: ${dynamicThreshold.toFixed(2)}%`);

    if (currentDiff >= dynamicThreshold) {
      // This is a legend candle
      const thresholdValue = currentCandle.close * (dynamicThreshold / 100);
      const legendCandle = {
        timestamp: moment(currentCandle.openTime).format('YYYY-MM-DD HH:mm:ss'),
        close: currentCandle.close,
        upward_movementThreshold: currentCandle.close + thresholdValue,
        downward_movementThreshold: currentCandle.close - thresholdValue,
        // Store the full candle data
        candleData: {
          open: currentCandle.open,
          high: currentCandle.high,
          low: currentCandle.low,
          close: currentCandle.close,
          volume: currentCandle.volume
        }
      };

      console.log(`
✨ LEGEND CANDLE FOUND!
Time: ${legendCandle.timestamp}
Close: ${legendCandle.close}
Upward Threshold: ${legendCandle.upward_movementThreshold}
Downward Threshold: ${legendCandle.downward_movementThreshold}`);

      // Check for threshold crossing
      const threshold_crossed = await this.checkThresholdCrossing(
        currentIndex,
        legendCandle
      );

      if (threshold_crossed.direction !== 'NONE') {
        // Calculate position size
        const tradeSize = this.calculateTradeSize(threshold_crossed.entry_price);

        // Check trade outcome
        const exit = await this.checkTradeOutcome(
          currentIndex + threshold_crossed.candles_until_cross,
          {
            price: threshold_crossed.entry_price,
            side: threshold_crossed.direction as 'LONG' | 'SHORT',
            size: tradeSize,
            dynamicThreshold
          }
        );

        if (exit) {
          const tradeResult = this.processTradeResult(
            {
              ...threshold_crossed,
              direction: threshold_crossed.direction as 'LONG' | 'SHORT'
            },
            exit,
            dynamicThreshold,
            currentDiff,
            legendCandle.candleData  // Pass the stored legend candle data
          );

          // Update balance
          this.updateBalance(tradeResult);

          // Store matching candle info with type-safe threshold_crossed
          this.storeMatchingCandle(
            currentCandle,
            legendCandle,
            {
              ...threshold_crossed,
              direction: threshold_crossed.direction as 'LONG' | 'SHORT'
            },
            tradeResult,
            dynamicThreshold,
            averageDiff
          );
        }
      }
    }
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
    entryCandleData?: {
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    };
  }> {
    for (let i = 1; i <= this.runConfig.trade.maxLookForwardCandles; i++) {
      if (startIndex + i >= this.candles.length) break;

      const candle = this.candles[startIndex + i];

      if (candle.high >= legendCandle.upward_movementThreshold) {
        return {
          direction: 'LONG',
          crossed_at: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
          entry_price: legendCandle.upward_movementThreshold,
          candles_until_cross: i,
          entryCandleData: {
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume
          }
        };
      }

      if (candle.low <= legendCandle.downward_movementThreshold) {
        return {
          direction: 'SHORT',
          crossed_at: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
          entry_price: legendCandle.downward_movementThreshold,
          candles_until_cross: i,
          entryCandleData: {
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume
          }
        };
      }
    }

    return {
      direction: 'NONE',
      crossed_at: '',
      entry_price: 0,
      candles_until_cross: 0
    };
  }

  private calculateTriggerLevels(
    entryPrice: number,
    side: 'LONG' | 'SHORT',
    dynamicThreshold: number
  ): TriggerLevel[] {
    const levels: TriggerLevel[] = [];
    const thresholdValue = entryPrice * (dynamicThreshold / 100);

    // Initial stop loss is always entry ± thresholdValue based on side
    const initialLevel: TriggerLevel = {
      trigger: entryPrice,
      stopLoss: side === 'LONG' 
        ? entryPrice - thresholdValue 
        : entryPrice + thresholdValue,
      triggered: true,  // Initial level is always triggered
      hit: false
    };
    levels.push(initialLevel);

    // Calculate subsequent trigger levels
    for (let i = 1; i <= this.runConfig.trade.trailingStop.maxTriggerLevels; i++) {
      if (side === 'LONG') {
        const trigger = entryPrice + (thresholdValue * i);
        const stopLoss = trigger - thresholdValue;  // Using original thresholdValue
        
        levels.push({
          trigger,
          stopLoss,
          triggered: false,
          hit: false
        });
      } else {  // SHORT
        const trigger = entryPrice - (thresholdValue * i);
        const stopLoss = trigger + thresholdValue;  // Using original thresholdValue
        
        levels.push({
          trigger,
          stopLoss,
          triggered: false,
          hit: false
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
    const triggerLevels = this.calculateTriggerLevels(
      entry.price,
      entry.side,
      entry.dynamicThreshold
    );

    let currentStopLoss = triggerLevels[0].stopLoss;
    let currentTriggerIndex = 1;

    const trailingHistory: (TrailingStopUpdate & { triggerCandle?: Candle })[] = [{
      price: currentStopLoss,
      time: moment(this.candles[startIndex].openTime).format('YYYY-MM-DD HH:mm:ss'),
      type: 'INITIAL',
      market_price: entry.price,
      profit_at_update: 0
    }];

    for (let i = 1; i <= this.runConfig.trade.maxLookForwardCandles; i++) {
      if (startIndex + i >= this.candles.length) return null;
      const candle = this.candles[startIndex + i];

      // Check stop loss hit
      if (entry.side === 'LONG' && candle.low <= currentStopLoss) {
        return this.createTradeExit(candle, currentStopLoss, i, trailingHistory);
      }
      if (entry.side === 'SHORT' && candle.high >= currentStopLoss) {
        return this.createTradeExit(candle, currentStopLoss, i, trailingHistory);
      }

      // Check trigger levels
      while (currentTriggerIndex < triggerLevels.length) {
        const nextTrigger = triggerLevels[currentTriggerIndex];
        
        if ((entry.side === 'LONG' && candle.high >= nextTrigger.trigger) ||
            (entry.side === 'SHORT' && candle.low <= nextTrigger.trigger)) {
          
          currentStopLoss = nextTrigger.stopLoss;
          trailingHistory.push({
            price: currentStopLoss,
            time: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
            type: entry.side === 'LONG' ? 'TRAIL_UP' : 'TRAIL_DOWN',
            market_price: entry.side === 'LONG' ? candle.high : candle.low,
            profit_at_update: ((entry.side === 'LONG' ? 1 : -1) * 
              (nextTrigger.trigger - entry.price) / entry.price) * 100,
            triggerCandle: candle  // Store the trigger candle
          });
          
          currentTriggerIndex++;
        } else {
          break;
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

  private async saveResults(results: any): Promise<void> {
    const formattedResults = {
      config: {
        symbol: this.symbol,
        threshold: this.runConfig.strategy.lookbackPeriod.threshold,
        num_previous_candles: this.runConfig.strategy.lookbackPeriod.candles,
        initial_balance: this.runConfig.account.initialBalance
      },
      trade_performance: {
        total_trades: this.matchingCandles.length,
        profitable_trades: this.matchingCandles.filter(
          c => c.trade_result && parseFloat(c.trade_result.trailing_details.trade_summary.PNL) > 0
        ).length,
        unprofitable_trades: this.matchingCandles.filter(
          c => c.trade_result && parseFloat(c.trade_result.trailing_details.trade_summary.PNL) <= 0
        ).length,
        win_rate: ((this.matchingCandles.filter(
          c => c.trade_result && parseFloat(c.trade_result.trailing_details.trade_summary.PNL) > 0
        ).length / this.matchingCandles.length) * 100).toFixed(2) + '%',
        by_direction: {
          long: {
            total_trades: this.matchingCandles.filter(
              c => c.trade_result?.entry.side === 'LONG'
            ).length,
            profitable_trades: this.matchingCandles.filter(
              c => c.trade_result?.entry.side === 'LONG' && 
                parseFloat(c.trade_result.trailing_details.trade_summary.PNL) > 0
            ).length,
            total_pnl: this.matchingCandles
              .filter(c => c.trade_result?.entry.side === 'LONG')
              .reduce((sum, trade) => 
                sum + (trade.trade_result ? parseFloat(trade.trade_result.trailing_details.trade_summary.PNL) : 0), 0
              ).toFixed(2) + ' USDT'
          },
          short: {
            total_trades: this.matchingCandles.filter(
              c => c.trade_result?.entry.side === 'SHORT'
            ).length,
            profitable_trades: this.matchingCandles.filter(
              c => c.trade_result?.entry.side === 'SHORT' && 
                parseFloat(c.trade_result.trailing_details.trade_summary.PNL) > 0
            ).length,
            total_pnl: this.matchingCandles
              .filter(c => c.trade_result?.entry.side === 'SHORT')
              .reduce((sum, trade) => 
                sum + (trade.trade_result ? parseFloat(trade.trade_result.trailing_details.trade_summary.PNL) : 0), 0
              ).toFixed(2) + ' USDT'
          }
        }
      },
      detailed_trades: this.matchingCandles
        .filter(c => c.trade_result !== null)
        .map(c => c.trade_result)
    };

    // Save to file
    const resultsDir = path.join(__dirname, '../results');
    const symbolDir = path.join(resultsDir, this.symbol);
    const resultFile = path.join(
      symbolDir, 
      `${this.runConfig.singleBacktest?.timeframe || 'default'}_results.json`
    );

    // Create directories if they don't exist
    if (!fs.existsSync(resultsDir)) {
      await fs.promises.mkdir(resultsDir);
    }
    if (!fs.existsSync(symbolDir)) {
      await fs.promises.mkdir(symbolDir);
    }

    await fs.promises.writeFile(
      resultFile,
      JSON.stringify(formattedResults, null, 2)
    );

    console.log(`\nResults saved to ${resultFile}`);
  }

  private createTradeExit(
    candle: Candle,
    stopLossPrice: number,
    candlesUntilExit: number,
    trailingHistory: (TrailingStopUpdate & { triggerCandle?: Candle })[]
  ): TradeExit {
    trailingHistory.push({
      price: stopLossPrice,
      time: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
      type: 'HIT',
      market_price: stopLossPrice,
      profit_at_update: 0  // This will be calculated in processTradeResult
    });

    return {
      price: stopLossPrice,
      time: moment(candle.openTime).format('YYYY-MM-DD HH:mm:ss'),
      type: 'TRAILING_STOP',
      candles_until_exit: candlesUntilExit,
      trailing_stops: trailingHistory
    };
  }

  private processTradeResult(
    entry: {
      direction: 'LONG' | 'SHORT';
      crossed_at: string;
      entry_price: number;
      candles_until_cross: number;
      entryCandleData?: {
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      };
    },
    exit: TradeExit,
    dynamicThreshold: number,
    currentDiff: number,
    legendCandleData: {
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }
  ): TradeDetailsResult {
    const { pnl, pnl_percentage } = this.calculatePnL(
      entry.entry_price,
      exit.price,
      entry.direction,
      1
    );

    // Format trails data
    const trails = exit.trailing_stops
      .filter(stop => stop.type !== 'INITIAL' && stop.type !== 'HIT')
      .map((stop: TrailingStopUpdate & { triggerCandle?: Candle }, index) => {
        // Calculate profit for this specific trail
        const profitAtThisTrail = entry.direction === 'LONG'
          ? stop.price - exit.trailing_stops[index].price  // For LONG: new_stop - old_stop
          : exit.trailing_stops[index].price - stop.price; // For SHORT: old_stop - new_stop

        // Calculate cumulative profit up to this trail
        const profitSoFar = entry.direction === 'LONG'
          ? stop.price - entry.entry_price  // For LONG: current_stop - entry
          : entry.entry_price - stop.price; // For SHORT: entry - current_stop

        return {
          trail_number: index + 1,
          time: stop.time,
          triggerValue: stop.market_price.toString(),
          old_stop_loss: exit.trailing_stops[index].price.toString(),
          new_stop_loss: stop.price.toString(),
          stop_loss_movement: `${((Math.abs(stop.price - exit.trailing_stops[index].price) / 
            exit.trailing_stops[index].price) * 100).toFixed(2)}%`,
          profit_at_this_trail: `${profitAtThisTrail.toFixed(2)} USDT`,  // Profit from this trail only
          TriggerCandleDetails: stop.triggerCandle ? {
            open: stop.triggerCandle.open.toString(),
            high: stop.triggerCandle.high.toString(),
            low: stop.triggerCandle.low.toString(),
            close: stop.triggerCandle.close.toString(),
            volume: stop.triggerCandle.volume.toString()
          } : {
            open: "",
            high: "",
            low: "",
            close: "",
            volume: ""
          },
          trail_details: {
            triggered_by: `trigger${(index + 1).toString().padStart(2, '0')}`,
            stoploss_distanceFrom_entry: `${((Math.abs(stop.price - entry.entry_price) / 
              entry.entry_price) * 100).toFixed(2)}%`,
            profit_so_far: `${profitSoFar.toFixed(2)} USDT`  // Cumulative profit up to this trail
          }
        };
      });

    return {
      trade_Number: this.matchingCandles.length + 1,
      timestamp: entry.crossed_at,
      LegendCandle: {
        currentDynamicThreshold: dynamicThreshold.toString(),
        LegendCandleDifference: currentDiff.toFixed(2),
        LegendCandleDetails: {
          open: legendCandleData.open.toString(),
          high: legendCandleData.high.toString(),
          low: legendCandleData.low.toString(),
          close: legendCandleData.close.toString(),
          volume: legendCandleData.volume.toString()
        }
      },
      entry: {
        reason: entry.direction === 'LONG' ? 'UpwardThresholdMet' : 'DownwardThresholdMet',
        side: entry.direction,
        price: entry.entry_price,
        formatted_price: `${entry.entry_price.toFixed(2)} USDT`,
        time: entry.crossed_at,
        PositionEntryCandleDetails: entry.entryCandleData ? {
          open: entry.entryCandleData.open.toString(),
          high: entry.entryCandleData.high.toString(),
          low: entry.entryCandleData.low.toString(),
          close: entry.entryCandleData.close.toString(),
          volume: entry.entryCandleData.volume.toString()
        } : {
          open: "",
          high: "",
          low: "",
          close: "",
          volume: ""
        },
        initial_stop: {
          price: exit.trailing_stops[0].price.toString(),
          distance_from_entry: `${(
            entry.direction === 'LONG' 
              ? -(entry.entry_price - exit.trailing_stops[0].price)  // For LONG: entry - stop
              : -(exit.trailing_stops[0].price - entry.entry_price)  // For SHORT: stop - entry
          ).toFixed(2)} USDT`,
          percentage_from_entry: `${(
            entry.direction === 'LONG'
              ? -((entry.entry_price - exit.trailing_stops[0].price) / entry.entry_price * 100)  // For LONG
              : -((exit.trailing_stops[0].price - entry.entry_price) / entry.entry_price * 100)  // For SHORT
          ).toFixed(2)}%`
        }
      },
      trailing_details: {
        trails,
        exit_details: {
          time: exit.time,
          exit_reason: `stoploss ${trails.length} hit`,
          final_stop_loss_price: exit.price.toString(),
          total_trails_before_exit: trails.length,
          PNL_in_percent: `${pnl_percentage.toFixed(2)}%`,
          PNL: `${pnl.toFixed(2)} USDT`
        },
        trade_summary: {
          entry_price: entry.entry_price,
          initialStoploss: exit.trailing_stops[0].price.toString(),
          numberOfTrails: trails.length,
          final_stop_loss_price: exit.price.toString(),
          PNL_in_percent: `${pnl_percentage.toFixed(2)}%`,
          PNL: `${pnl.toFixed(2)} USDT`
        }
      },
      balance_after_trade: this.currentBalance + pnl
    };
  }

  private storeMatchingCandle(
    currentCandle: Candle,
    legendCandle: {
      timestamp: string;
      close: number;
      upward_movementThreshold: number;
      downward_movementThreshold: number;
    },
    threshold_crossed: {
      direction: 'LONG' | 'SHORT';
      crossed_at: string;
      entry_price: number;
      candles_until_cross: number;
    },
    tradeResult: TradeDetailsResult,
    dynamicThreshold: number,
    averageDiff: number
  ): void {
    this.matchingCandles.push({
      timestamp: legendCandle.timestamp,
      open: currentCandle.open,
      close: currentCandle.close,
      movement: Math.abs((currentCandle.close - currentCandle.open) / currentCandle.open) * 100,
      dynamicThreshold,
      averageMovement: averageDiff,
      numPreviousCandles: this.runConfig.strategy.lookbackPeriod.candles,
      upward_movementThreshold: legendCandle.upward_movementThreshold,
      downward_movementThreshold: legendCandle.downward_movementThreshold,
      entry_instructions: {
        long: `Enter LONG if price crosses above ${legendCandle.upward_movementThreshold.toFixed(2)} USDT`,
        short: `Enter SHORT if price crosses below ${legendCandle.downward_movementThreshold.toFixed(2)} USDT`
      },
      threshold_crossed,
      trade_result: tradeResult
    });
  }

  async findMatchingCandles(): Promise<void> {
    const lookbackPeriod = this.runConfig.strategy.lookbackPeriod.candles + 10;

    for (let i = lookbackPeriod; i < this.candles.length; i++) {
      const currentCandle = this.candles[i];
      const lookbackCandles = this.candles.slice(i - lookbackPeriod, i);
      await this.processCandle(currentCandle, lookbackCandles, i);
    }

    await this.saveResults(this.matchingCandles);
  }

  private calculateTradeSize(entryPrice: number): number {
    const positionSize =
      (this.currentBalance * config.account.positionSizePercent) / 100;
    return positionSize / entryPrice; // Convert USDT to token quantity
  }

  private updateBalance(tradeResult: TradeDetailsResult): void {
    this.currentBalance = tradeResult.balance_after_trade;
    
    this.balanceHistory.push({
      timestamp: tradeResult.trailing_details.exit_details.time,
      balance: this.currentBalance,
      trade_pnl: parseFloat(tradeResult.trailing_details.trade_summary.PNL),
      trade_type: 'TRAILING_STOP'
    });
  }
}