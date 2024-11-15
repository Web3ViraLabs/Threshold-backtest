export interface TradingConfig {
  account: {
    initialBalance: number;
    positionSizePercent: number;
  };

  lookbackPeriod: {
    candles: number;
    threshold: number;
  };

  trade: {
    maxLookForwardCandles: number;
    trailingStop: {
      enabled: boolean;
      maxTriggerLevels: number;
      usesDynamicThreshold: boolean;
      minProfitToTrail?: number;
      trailUpdateLog: boolean;
    }
  };

  pairs: {
    [key: string]: {
      enabled: boolean;
      num_previous_candles: number;
      threshold: number;
    };
  };
}

const config: TradingConfig = {
  account: {
    initialBalance: 10000,
    positionSizePercent: 100,
  },

  lookbackPeriod: {
    candles: 72,
    threshold: 10,
  },

  trade: {
    maxLookForwardCandles: 720,
    trailingStop: {
      enabled: true,
      maxTriggerLevels: 20,
      usesDynamicThreshold: true,
      minProfitToTrail: 0,
      trailUpdateLog: true
    }
  },

  pairs: {
    ETHUSDT: {
      enabled: true,
      num_previous_candles: 72,
      threshold: 10,
    },
  },
};

export default config;
