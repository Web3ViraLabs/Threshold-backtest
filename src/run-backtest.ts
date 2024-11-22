import { BatchProcessor } from './batch-processor';
import { Backtester } from './backtest';
import { DataFetcher } from './data-fetcher';
import config from './config';
import path from 'path';
import fs from 'fs';

async function getAllCsvFiles(symbol: string, timeframe: string): Promise<string[]> {
  const klineDir = path.join(
    __dirname, 
    `../kline/${symbol}/${timeframe}/csv`
  );
  const files = await fs.promises.readdir(klineDir);
  return files
    .filter((file) => file.endsWith('.csv'))
    .sort()
    .map((file) => path.join(klineDir, file));
}

async function runSingleBacktest() {
  if (!config.singleBacktest) {
    throw new Error('Single backtest configuration is missing');
  }

  const { symbol, timeframe } = config.singleBacktest;
  
  console.log(`Running single backtest for ${symbol} on ${timeframe} timeframe`);
  
  // First: Download data
  console.log('\n=== Starting Data Download Phase ===');
  const dataFetcher = new DataFetcher(symbol, config);
  await dataFetcher.fetchHistoricalData();
  console.log('✅ Data download complete');

  // Second: Run backtest
  console.log('\n=== Starting Backtest Phase ===');
  const backtester = new Backtester(symbol, config);
  const csvFiles = await getAllCsvFiles(symbol, timeframe);

  console.log(`Loading ${csvFiles.length} CSV files...`);
  for (const csvFile of csvFiles) {
    await backtester.loadData(csvFile);
  }

  await backtester.findMatchingCandles();
  console.log('✅ Backtest complete');
}

async function runBatchBacktest() {
  const batchProcessor = new BatchProcessor(
    config.backtestMode.batchProcessing?.parallel || false,
    config.backtestMode.batchProcessing?.concurrencyLimit
  );
  
  try {
    await batchProcessor.processAll();
    await batchProcessor.generateSummaryReport();
  } catch (error) {
    console.error('Error in batch processing:', error);
    process.exit(1);
  }
}

async function main() {
  try {
    if (config.backtestMode.type === 'single') {
      await runSingleBacktest();
    } else {
      await runBatchBacktest();
    }
  } catch (error) {
    console.error('Error running backtest:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error running analysis:', error);
  process.exit(1);
});