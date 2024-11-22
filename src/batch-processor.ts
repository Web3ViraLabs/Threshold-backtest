import { Backtester } from './backtest';
import { DataFetcher } from './data-fetcher';
import path from 'path';
import fs from 'fs';
import config, { TradingConfig, AVAILABLE_SYMBOLS, AVAILABLE_TIMEFRAMES } from './config';

export class BatchProcessor {
  private symbols = AVAILABLE_SYMBOLS;
  private timeframes = AVAILABLE_TIMEFRAMES;
  private completedBacktests: Set<string> = new Set();

  constructor(
    private useParallel: boolean = false,
    private concurrencyLimit: number = 5
  ) {}

  private async downloadData(
    symbol: string, 
    timeframe: typeof AVAILABLE_TIMEFRAMES[number]
  ): Promise<void> {
    try {
      console.log(`\n=== Downloading data for ${symbol} - ${timeframe} ===`);
      
      const runConfig: TradingConfig = {
        ...config,
        singleBacktest: {
          symbol,
          timeframe
        }
      };

      const dataFetcher = new DataFetcher(symbol, runConfig);
      await dataFetcher.fetchHistoricalData();
      
      console.log(`✅ Downloaded data for ${symbol} - ${timeframe}`);
    } catch (error) {
      console.error(`❌ Error downloading data for ${symbol} - ${timeframe}:`, error);
      throw error;
    }
  }

  private async runBacktest(
    symbol: string, 
    timeframe: typeof AVAILABLE_TIMEFRAMES[number]
  ): Promise<void> {
    try {
      console.log(`\n=== Running backtest for ${symbol} - ${timeframe} ===`);
      
      const runConfig: TradingConfig = {
        ...config,
        singleBacktest: {
          symbol,
          timeframe
        }
      };

      const backtester = new Backtester(symbol, runConfig);
      const csvFiles = await this.getAllCsvFiles(symbol, timeframe);

      if (csvFiles.length === 0) {
        console.log(`No CSV files found for ${symbol} - ${timeframe}`);
        return;
      }

      console.log(`Loading ${csvFiles.length} CSV files...`);
      for (const csvFile of csvFiles) {
        await backtester.loadData(csvFile);
      }

      await backtester.findMatchingCandles();
      
      // Verify results were saved
      const resultPath = path.join(
        __dirname, 
        `../results/${symbol}/${timeframe}_results.json`
      );
      
      if (fs.existsSync(resultPath)) {
        this.completedBacktests.add(`${symbol}-${timeframe}`);
        console.log(`✅ Completed backtest for ${symbol} - ${timeframe}`);
      } else {
        throw new Error(`Results file not created for ${symbol} - ${timeframe}`);
      }
    } catch (error) {
      console.error(`❌ Error in backtest for ${symbol} - ${timeframe}:`, error);
      throw error;
    }
  }

  private async downloadAllData(): Promise<void> {
    console.log('\n=== Starting Data Download Phase ===');
    const totalDownloads = this.symbols.length * this.timeframes.length;
    console.log(`Total downloads needed: ${totalDownloads}`);

    if (this.useParallel) {
      const queue = [];
      for (const symbol of this.symbols) {
        for (const timeframe of this.timeframes) {
          queue.push({ symbol, timeframe });
        }
      }

      while (queue.length > 0) {
        const batch = queue.splice(0, this.concurrencyLimit);
        await Promise.all(
          batch.map(({ symbol, timeframe }) => 
            this.downloadData(symbol, timeframe)
          )
        );
        console.log(`Remaining downloads: ${queue.length}`);
      }
    } else {
      let completed = 0;
      for (const symbol of this.symbols) {
        for (const timeframe of this.timeframes) {
          await this.downloadData(symbol, timeframe);
          completed++;
          console.log(`Download progress: ${completed}/${totalDownloads}`);
        }
      }
    }

    console.log('\n✅ All data downloads completed');
  }

  private async runAllBacktests(): Promise<void> {
    console.log('\n=== Starting Backtest Phase ===');
    const totalBacktests = this.symbols.length * this.timeframes.length;
    console.log(`Total backtests to run: ${totalBacktests}`);

    if (this.useParallel) {
      const queue = [];
      for (const symbol of this.symbols) {
        for (const timeframe of this.timeframes) {
          queue.push({ symbol, timeframe });
        }
      }

      while (queue.length > 0) {
        const batch = queue.splice(0, this.concurrencyLimit);
        await Promise.all(
          batch.map(({ symbol, timeframe }) => 
            this.runBacktest(symbol, timeframe)
          )
        );
        console.log(`Remaining backtests: ${queue.length}`);
      }
    } else {
      let completed = 0;
      for (const symbol of this.symbols) {
        for (const timeframe of this.timeframes) {
          await this.runBacktest(symbol, timeframe);
          completed++;
          console.log(`Backtest progress: ${completed}/${totalBacktests}`);
        }
      }
    }

    console.log('\n✅ All backtests completed');
  }

  async processAll(): Promise<void> {
    console.log(`Starting batch processing in ${this.useParallel ? 'parallel' : 'sequential'} mode`);
    
    // First phase: Download all data
    await this.downloadAllData();
    
    // Second phase: Run all backtests
    await this.runAllBacktests();
    
    // Generate summary
    await this.generateSummaryReport();
    
    console.log('\nBatch processing complete!');
  }

  private async getAllCsvFiles(symbol: string, timeframe: string): Promise<string[]> {
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

  async generateSummaryReport(): Promise<void> {
    console.log('\n=== Generating Summary Report ===');
    const summaryDir = path.join(__dirname, '../results/summary');
    if (!fs.existsSync(summaryDir)) {
      await fs.promises.mkdir(summaryDir, { recursive: true });
    }

    const summary = {
      timestamp: new Date().toISOString(),
      total_combinations: this.symbols.length * this.timeframes.length,
      completed_backtests: this.completedBacktests.size,
      results: [] as any[]
    };

    for (const symbol of this.symbols) {
      for (const timeframe of this.timeframes) {
        const backTestId = `${symbol}-${timeframe}`;
        if (!this.completedBacktests.has(backTestId)) {
          console.log(`Skipping ${backTestId} - backtest not completed successfully`);
          continue;
        }

        const resultPath = path.join(
          __dirname, 
          `../results/${symbol}/${timeframe}_results.json`
        );

        try {
          const result = JSON.parse(await fs.promises.readFile(resultPath, 'utf8'));
          summary.results.push({
            symbol,
            timeframe,
            trade_count: result.trade_performance.total_trades,
            win_rate: result.trade_performance.win_rate,
            total_return: result.trade_performance.total_return
          });
          console.log(`✅ Added results for ${symbol} - ${timeframe} to summary`);
        } catch (error) {
          console.error(`Error reading results for ${symbol} - ${timeframe}:`, error);
        }
      }
    }

    // Save summary report
    const summaryPath = path.join(summaryDir, `batch_summary_${Date.now()}.json`);
    await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`\n✅ Summary report saved to ${summaryPath}`);
    console.log(`Completed ${summary.completed_backtests} out of ${summary.total_combinations} backtests`);
  }
} 