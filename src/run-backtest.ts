import { Backtester } from './backtest';
import path from 'path';
import fs from 'fs';
import config from './config';

async function getAllCsvFiles(symbol: string): Promise<string[]> {
  const klineDir = path.join(__dirname, `../kline/${symbol}/1m-csv`);
  const files = await fs.promises.readdir(klineDir);
  return files
    .filter((file) => file.endsWith('.csv'))
    .sort()
    .map((file) => path.join(klineDir, file));
}

async function main() {
  // Get symbol from config's first enabled pair
  const symbol =
    Object.entries(config.pairs).find(
      ([_, settings]) => settings.enabled
    )?.[0] || 'ETHUSDT';

  // Use values from config
  const backtester = new Backtester(symbol);
  const csvFiles = await getAllCsvFiles(symbol);

  console.log(`Found ${csvFiles.length} CSV files for ${symbol}`);
  console.log(`
Configuration:
-------------
Account:
- Initial Balance: ${config.account.initialBalance} USDT
- Position Size: ${config.account.positionSizePercent}%

Analysis:
- Lookback Period: ${config.lookbackPeriod.candles} candles
- Threshold Multiplier: ${config.lookbackPeriod.threshold}x
- Max Forward Look: ${config.trade.maxLookForwardCandles} candles

Trailing Stop:
- Enabled: ${config.trade.trailingStop.enabled}
- Max Trigger Levels: ${config.trade.trailingStop.maxTriggerLevels}
- Uses Dynamic Threshold: ${config.trade.trailingStop.usesDynamicThreshold}
    `);

  // Load all CSV files sequentially
  for (const csvFile of csvFiles) {
    await backtester.loadData(csvFile);
  }

  console.log('\nAnalyzing candles...');
  await backtester.findMatchingCandles();
}

main().catch((error) => {
  console.error('Error running analysis:', error);
  process.exit(1);
});
