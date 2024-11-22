export interface TradingConfig {
  account: {
    initialBalance: number;
    positionSizePercent: number;
  };

  strategy: {
    lookbackPeriod: {
      candles: number;
      threshold: number;
    };
  };

  trade: {
    maxLookForwardCandles: number;
    trailingStop: {
      enabled: boolean;
      maxTriggerLevels: number;
      usesDynamicThreshold: boolean;
      minProfitToTrail?: number;
      trailUpdateLog: boolean;
    };
  };

  // Single backtest configuration
  singleBacktest?: {
    symbol: string;
    timeframe: (typeof AVAILABLE_TIMEFRAMES)[number];
  };

  // Market type configuration
  market: {
    type: 'futures' | 'spot';
    subType: 'um' | 'cm'; // um for USD-M futures, cm for COIN-M futures
  };

  backtestMode: {
    type: 'single' | 'batch';
    batchProcessing?: {
      parallel: boolean;
      concurrencyLimit?: number;
    };
  };

  dataFetch: {
    startDate: {
      year: number;
      month: number;
    };
    endDate?: {
      year: number;
      month: number;
    };
  };
}

const config: TradingConfig = {
  account: {
    initialBalance: 1000,
    positionSizePercent: 100,
  },

  strategy: {
    lookbackPeriod: {
      candles: 72,
      threshold: 10,
    },
  },

  trade: {
    maxLookForwardCandles: 720,
    trailingStop: {
      enabled: true,
      maxTriggerLevels: 20,
      usesDynamicThreshold: true,
      minProfitToTrail: 0.5,
      trailUpdateLog: true,
    },
  },

  // Only used when backtestMode.type is 'single'
  singleBacktest: {
    symbol: 'ETHUSDT',
    timeframe: '2h',
  },

  market: {
    type: 'futures',
    subType: 'um',
  },

  backtestMode: {
    type: 'batch', // Change to 'single' for single pair testing
    batchProcessing: {
      parallel: true,
      concurrencyLimit: 100,
    },
  },

  dataFetch: {
    startDate: {
      year: 2022,
      month: 1,
    },
    endDate: {
      year: 2024,
      month: 10,
    },
  },
};

export const AVAILABLE_SYMBOLS = [
  'ETHUSDT',
  'XRPUSDT',
  'ADAUSDT',
  'SOLUSDT',
  'LTCUSDT',
  'XMRUSDT',
  '1000SHIBUSDT',
] as const;

export const AVAILABLE_TIMEFRAMES = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
] as const;

export default config;
