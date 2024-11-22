# Cryptocurrency Trading Backtester Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Data Flow](#data-flow)
4. [Components](#components)
5. [Trading Strategy](#trading-strategy)
6. [Performance Analysis](#performance-analysis)

## System Overview

The Cryptocurrency Trading Backtester is a sophisticated TypeScript-based system designed to simulate and analyze trading strategies using historical price data. It focuses on identifying significant price movements and executing trades based on dynamic thresholds and trailing stop mechanisms.

### Key Features
- Historical data processing from CSV files
- Dynamic threshold calculation based on market volatility
- Advanced trailing stop mechanism
- Detailed trade performance analysis
- Balance tracking and risk management
- Comprehensive trade metrics and reporting

## Architecture

### Core Components
1. **Backtester Class** (`src/backtest.ts`)
   - Main engine for processing historical data
   - Implements trading logic and position management
   - Handles trade execution and performance tracking

2. **Configuration** (`src/config.ts`)
   - Trading pair settings
   - Account parameters
   - Strategy configurations
   - Risk management rules

3. **Interfaces** (`src/interfaces.ts`)
   - Type definitions for data structures
   - Trade result interfaces
   - Candle data structures

## Data Flow

### 1. Data Loading Process
```typescript
async loadData(csvFilePath: string): Promise<void> {
  // CSV parsing using csv-parser
  // Format: timestamp,open,high,low,close,volume
  // Data is stored in candles array
}
```

### 2. Candle Processing
The system processes candles sequentially, analyzing each for potential trading opportunities:

a) **Candle Structure**
```typescript
interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}
```

b) **Movement Analysis**
- Calculates price movement percentage
- Compares against dynamic threshold
- Identifies potential entry points

### 3. Dynamic Threshold Calculation
```typescript
// Calculate volatility using standard deviation
const previousDiffs = lookbackCandles.map(candle => 
  math.abs((candle.close - candle.open) / candle.open) * 100
);
const avgDiff = math.mean(previousDiffs);
const stdDev = math.std(previousDiffs);

// Dynamic threshold calculation
const baseThreshold = config.lookbackPeriod.threshold;
const volatilityAdjustment = stdDev / avgDiff;
const dynamicThreshold = baseThreshold * (avgDiff * (1 + volatilityAdjustment)) / 2;
```

### 4. Trading Logic

#### Entry Conditions
1. Current candle movement exceeds dynamic threshold
2. Price crosses above/below specified levels
3. Position size calculation based on account balance

#### Trailing Stop Mechanism
```typescript
interface TriggerLevel {
  trigger: number;
  stopLoss: number;
  triggered: boolean;
  hit: boolean;
}
```

The trailing stop system uses multiple trigger levels:
1. Initial stop loss based on entry price
2. Progressive stop loss adjustments
3. Trailing stop updates based on price movement

## Performance Analysis

### Trade Metrics
- Total PnL
- Win rate
- Average trade profit
- Maximum drawdown
- Risk-adjusted returns

### Balance Tracking
```typescript
interface BalanceUpdate {
  timestamp: string;
  balance: number;
  trade_pnl: number;
  trade_type: string;
}
```

### Trade Result Structure
```typescript
interface TradeResult {
  entry: {
    price: number;
    time: string;
    side: 'LONG' | 'SHORT';
  };
  exit: {
    price: number;
    time: string;
    type: string;
  };
  pnl: number;
  pnl_percentage: number;
  trailing_metrics: {
    total_trails: number;
    average_trail_distance: number;
    largest_trail: number;
    profit_saved_by_trailing: number;
  };
}
```

## Risk Management

### Position Sizing
```typescript
private calculateTradeSize(entryPrice: number): number {
  const positionSize = (this.currentBalance * config.account.positionSizePercent) / 100;
  return positionSize / entryPrice;
}
```

### Stop Loss Management
1. Initial stop loss placement
2. Dynamic adjustment based on price action
3. Trailing stop updates
4. Risk per trade limitations

## Configuration Options

### Account Settings
```typescript
interface AccountConfig {
  initialBalance: number;
  positionSizePercent: number;
  maxDailyDrawdown: number;
}
```

### Trading Parameters
```typescript
interface TradingConfig {
  lookbackPeriod: {
    candles: number;
    threshold: number;
  };
  trailingStop: {
    initialDistance: number;
    updateThreshold: number;
  };
}
```

## CSV Data Format
The system expects CSV files with the following structure:
```
open_time,open,high,low,close,volume,close_time
1641009600000,47200.1,47300.5,47150.2,47250.3,1234.56,1641013199999
```

### Data Requirements
- 1-hour candle data
- Timestamps in milliseconds
- Price data with sufficient decimal places
- Consistent data format across all files

## Implementation Details

### 1. CSV Parsing
```typescript
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
  });
```

### 2. Threshold Analysis
1. Calculate price movements
2. Determine market volatility
3. Adjust thresholds dynamically
4. Identify potential trade setups

### 3. Trade Execution
1. Entry point identification
2. Position size calculation
3. Stop loss placement
4. Trailing stop management
5. Exit condition monitoring

### 4. Performance Tracking
1. Trade-by-trade analysis
2. Balance updates
3. Risk metrics calculation
4. Performance statistics

## Best Practices

### 1. Data Handling
- Validate CSV data format
- Handle missing or invalid data
- Ensure consistent timestamp ordering
- Process data in efficient batches

### 2. Risk Management
- Implement position sizing rules
- Monitor drawdown limits
- Maintain stop loss discipline
- Track exposure levels

### 3. Performance Optimization
- Efficient data structures
- Batch processing
- Memory management
- Error handling

## Error Handling

### 1. Data Validation
```typescript
private validateCandle(candle: Candle): boolean {
  return (
    candle.openTime > 0 &&
    candle.open > 0 &&
    candle.high >= candle.low &&
    candle.volume >= 0
  );
}
```

### 2. Error Recovery
- Handle missing data points
- Recover from processing errors
- Maintain data integrity
- Log error conditions

## Future Enhancements

1. **Multi-timeframe Analysis**
   - Implement multiple timeframe support
   - Add timeframe correlation analysis
   - Enhanced entry/exit conditions

2. **Advanced Risk Management**
   - Position sizing optimization
   - Dynamic risk adjustment
   - Portfolio-level risk controls

3. **Machine Learning Integration**
   - Pattern recognition
   - Predictive analytics
   - Risk assessment models

4. **Performance Optimization**
   - Parallel processing
   - Data caching
   - Memory optimization

## Conclusion

This backtesting system provides a robust framework for testing and analyzing trading strategies. Its modular design, comprehensive risk management, and detailed performance analysis make it a valuable tool for strategy development and optimization.
