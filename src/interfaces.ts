export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface Pair {
  symbol: string;
  threshold: number;
  num_previous_candles: number;
}

export interface TrailingStopUpdate {
  price: number;
  time: string;
  type: 'INITIAL' | 'TRAIL_UP' | 'TRAIL_DOWN' | 'HIT';
  market_price: number;
  profit_at_update: number;
}

export interface TradeExit {
  price: number;
  time: string;
  type: 'TRAILING_STOP';
  candles_until_exit: number;
  trailing_stops: TrailingStopUpdate[];
}

export interface TradeResult {
  entry: {
      price: number;
      time: string;
      side: 'LONG' | 'SHORT';
      candles_until_entry: number;
  };
  exit: TradeExit;
  pnl: number;
  pnl_percentage: number;
  trailing_stop_history: TrailingStopUpdate[];
  max_profit_reached: number;
  max_profit_percentage: number;
  final_profit: number;
  final_profit_percentage: number;
  trailing_metrics: {
      total_trails: number;
      average_trail_distance: number;
      largest_trail: number;
      profit_saved_by_trailing: number;
  };
}

export interface BalanceUpdate {
  timestamp: string;
  balance: number;
  trade_pnl: number;
  trade_type: 'TRAILING_STOP';
}

export interface MatchingCandle {
  timestamp: string;
  open: number;
  close: number;
  movement: number;
  dynamicThreshold: number;
  averageMovement: number;
  numPreviousCandles: number;
  upward_movementThreshold: number;
  downward_movementThreshold: number;
  entry_instructions: {
      long: string;
      short: string;
  };
  threshold_crossed: {
      direction: 'LONG' | 'SHORT';
      crossed_at: string;
      entry_price: number;
      candles_until_cross: number;
  };
  trade_result: TradeDetailsResult | null;
}

export interface TradeDetails {
  timestamp: string;
  entry: {
      price: number;
      time: string;
      side: 'LONG' | 'SHORT';
      formatted_price: string;
  };
  trailing_details: {
      initial_stop: {
          price: string;
          time: string;
          distance_from_entry: string;
          percentage_from_entry: string;
      };
      trail_updates: Array<{
          step: number;
          time: string;
          old_stop: string;
          new_stop: string;
          market_price: string;
          profit_at_update: string;
          movement: string;
      }>;
      exit: {
          price: string;
          time: string;
          market_price: string;
          total_trails: number;
          max_profit_seen: string;
          final_profit: string;
          efficiency: string;
      };
      metrics: {
          total_trails: number;
          average_trail_distance: string;
          largest_trail: string;
          profit_saved: string;
      };
  } | null;
  balance_after_trade: number | null;
}

export interface TriggerLevel {
  trigger: number;
  stopLoss: number;
  triggered: boolean;
  hit: boolean;
}

export interface TradeDetailsResult {
  trade_Number: number;
  timestamp: string;
  LegendCandle: {
    currentDynamicThreshold: string;
    LegendCandleDifference: string;
    LegendCandleDetails: {
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
    };
  };
  entry: {
    reason: string;
    side: 'LONG' | 'SHORT';
    price: number;
    formatted_price: string;
    time: string;
    PositionEntryCandleDetails: {
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string;
    };
    initial_stop: {
      price: string;
      distance_from_entry: string;
      percentage_from_entry: string;
    };
  };
  trailing_details: {
    trails: Array<{
      trail_number: number;
      time: string;
      triggerValue: string;
      old_stop_loss: string;
      new_stop_loss: string;
      stop_loss_movement: string;
      profit_at_this_trail: string;
      TriggerCandleDetails: {
        open: string;
        high: string;
        low: string;
        close: string;
        volume: string;
      };
      trail_details: {
        triggered_by: string;
        stoploss_distanceFrom_entry: string;
        profit_so_far: string;
      };
    }>;
    exit_details: {
      time: string;
      exit_reason: string;
      final_stop_loss_price: string;
      total_trails_before_exit: number;
      PNL_in_percent: string;
      PNL: string;
    };
    trade_summary: {
      entry_price: number;
      initialStoploss: string;
      numberOfTrails: number;
      final_stop_loss_price: string;
      PNL_in_percent: string;
      PNL: string;
    };
  };
  balance_after_trade: number;
} 