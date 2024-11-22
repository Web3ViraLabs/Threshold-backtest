# Cryptocurrency Trading Backtester

A sophisticated TypeScript-based backtesting system for cryptocurrency trading strategies. This system processes historical price data to simulate and analyze trading strategies with dynamic thresholds and trailing stops.

## Features

- Historical data processing from CSV files
- Dynamic threshold calculation based on market volatility
- Advanced trailing stop mechanism
- Detailed trade performance analysis
- Balance tracking and risk management
- Comprehensive trade metrics and reporting

## Prerequisites

- Node.js (v14 or higher)
- TypeScript (v4.5 or higher)
- npm or yarn package manager

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd crypto-backtester
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Usage

1. Prepare your data:
   - Download historical price data in CSV format
   - Place CSV files in the `data` directory
   - Format: `open_time,open,high,low,close,volume,close_time`

2. Configure your strategy:
   - Edit `src/config.ts` to set your parameters:
     * Account settings (initial balance, position size)
     * Trading pair configurations
     * Lookback period and thresholds
     * Trailing stop settings

3. Run the backtester:
```bash
npm run start
```

4. View results:
   - Check the console output for trade statistics
   - Results are saved in `matching_candles.json`

## Configuration

### Account Settings
```typescript
account: {
  initialBalance: 10000,      // Initial balance in USDT
  positionSizePercent: 10,    // Position size as % of balance
  maxDailyDrawdown: 5,        // Maximum daily drawdown %
}
```

### Trading Parameters
```typescript
lookbackPeriod: {
  candles: 24,               // Number of candles to analyze
  threshold: 0.5,            // Base threshold multiplier
}
```

### Trailing Stop Settings
```typescript
trailingStop: {
  initialDistance: 1,        // Initial stop loss distance %
  updateThreshold: 0.5,      // Update trigger threshold %
  maxLevels: 20,            // Maximum trailing levels
}
```

## Project Structure

```
crypto-backtester/
├── src/
│   ├── backtest.ts          # Core backtesting engine
│   ├── config.ts            # Configuration settings
│   ├── interfaces.ts        # Type definitions
│   └── run-backtest.ts      # Main execution script
├── data/                    # CSV data files
├── documentation.md         # Detailed documentation
└── README.md               # This file
```

## Documentation

For detailed information about the system's architecture, implementation details, and trading strategy, please refer to [documentation.md](documentation.md).

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with TypeScript and Node.js
- Uses [moment.js](https://momentjs.com/) for date handling
- Uses [mathjs](https://mathjs.org/) for mathematical calculations
- Uses [csv-parser](https://github.com/mafintosh/csv-parser) for data parsing
