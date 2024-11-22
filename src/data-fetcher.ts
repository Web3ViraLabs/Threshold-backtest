import axios, { AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import config, { TradingConfig } from './config';
import crypto from 'crypto';

interface DataAvailability {
  symbol: string;
  firstAvailable: {
    year: number;
    month: number;
  };
  lastAvailable: {
    year: number;
    month: number;
  };
  timeframes: {
    [key: string]: {
      downloaded: boolean;
      firstDownloaded?: {
        year: number;
        month: number;
      };
      lastDownloaded?: {
        year: number;
        month: number;
      };
    };
  };
  lastUpdated: string;
}

export class DataFetcher {
  private baseUrl = 'https://data.binance.vision';
  private timeframe: string;
  
  constructor(
    private symbol: string,
    private runConfig: TradingConfig = config
  ) {
    this.timeframe = runConfig.backtestMode.type === 'single' 
      ? runConfig.singleBacktest!.timeframe
      : runConfig.singleBacktest?.timeframe || '1h';
  }

  private async createDirectories(): Promise<void> {
    const dirs = [
      path.join(__dirname, '../kline'),
      path.join(__dirname, `../kline/${this.symbol}`),
      path.join(__dirname, `../kline/${this.symbol}/${this.timeframe}`),
      path.join(__dirname, `../kline/${this.symbol}/${this.timeframe}/zip`),
      path.join(__dirname, `../kline/${this.symbol}/${this.timeframe}/csv`)
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
    }
  }

  private async downloadFile(url: string, outputPath: string): Promise<void> {
    console.log(`Downloading from: ${url}`);
    
    try {
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
        }
      });

      await fs.promises.writeFile(outputPath, response.data);
      console.log(`Successfully downloaded to ${outputPath}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Failed to download ${url}:`, error.message);
      } else {
        console.error(`Failed to download ${url}:`, error);
      }
      throw error;
    }
  }

  private async downloadChecksum(url: string): Promise<string> {
    try {
      const response = await axios.get(`${url}.CHECKSUM`);
      return response.data.split(' ')[0];
    } catch (error) {
      if (error instanceof Error) {
        console.warn(`Failed to download checksum for ${url}:`, error.message);
      } else {
        console.warn(`Failed to download checksum for ${url}:`, error);
      }
      return '';
    }
  }

  private async verifyChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
    if (!expectedChecksum) return true;

    try {
      const fileBuffer = await fs.promises.readFile(filePath);
      const hashSum = crypto.createHash('sha256');
      hashSum.update(fileBuffer);
      const calculatedChecksum = hashSum.digest('hex');

      const isValid = calculatedChecksum === expectedChecksum;
      if (!isValid) {
        console.warn(`Checksum mismatch for ${filePath}`);
        console.warn(`Expected: ${expectedChecksum}`);
        console.warn(`Got: ${calculatedChecksum}`);
      }
      return isValid;
    } catch (error) {
      if (error instanceof Error) {
        console.warn(`Checksum verification failed for ${filePath}:`, error.message);
      } else {
        console.warn(`Checksum verification failed for ${filePath}:`, error);
      }
      return false;
    }
  }

  private async verifyExtractedFiles(csvDir: string): Promise<boolean> {
    try {
      const files = await fs.promises.readdir(csvDir);
      const csvFiles = files.filter(f => f.endsWith('.csv'));
      
      if (csvFiles.length === 0) {
        console.error(`No CSV files found in ${csvDir}`);
        return false;
      }

      // Verify each CSV file has content
      for (const file of csvFiles) {
        const filePath = path.join(csvDir, file);
        const stats = await fs.promises.stat(filePath);
        if (stats.size === 0) {
          console.error(`CSV file is empty: ${filePath}`);
          return false;
        }
      }

      console.log(`✅ Verified ${csvFiles.length} CSV files in ${csvDir}`);
      return true;
    } catch (error) {
      console.error(`Error verifying CSV files: ${error}`);
      return false;
    }
  }

  private async unzipFile(zipPath: string, extractPath: string): Promise<void> {
    try {
      console.log(`\nUnzipping ${path.basename(zipPath)}`);
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();
      
      console.log(`Found ${zipEntries.length} files in zip`);
      
      // Extract and verify each entry
      zipEntries.forEach(entry => {
        console.log(`Extracting: ${entry.entryName} (${entry.getData().length} bytes)`);
      });

      zip.extractAllTo(extractPath, true);
      
      // Verify extraction
      const extracted = await this.verifyExtractedFiles(extractPath);
      if (!extracted) {
        throw new Error('Failed to verify extracted files');
      }
    } catch (error) {
      console.error(`Failed to extract ${zipPath}:`, error);
      throw error;
    }
  }

  private getMonthlyFileNames(): string[] {
    const files: string[] = [];
    const startDate = new Date(
      config.dataFetch.startDate.year, 
      config.dataFetch.startDate.month - 1  // JavaScript months are 0-based
    );
    
    const endDate = config.dataFetch.endDate 
      ? new Date(
          config.dataFetch.endDate.year,
          config.dataFetch.endDate.month - 1
        )
      : new Date();  // Current date if not specified
    
    let currentYear = startDate.getFullYear();
    let currentMonth = startDate.getMonth();

    while (
      currentYear < endDate.getFullYear() || 
      (currentYear === endDate.getFullYear() && currentMonth <= endDate.getMonth())
    ) {
      const fileName = `${this.symbol}-${this.timeframe}-${currentYear}-${String(
        currentMonth + 1
      ).padStart(2, '0')}`;
      files.push(fileName);

      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
    }
    
    return files;
  }

  private async updateDataAvailability(
    firstAvailable: { year: number; month: number },
    lastAvailable: { year: number; month: number }
  ): Promise<void> {
    try {
      const dataFilePath = path.join(
        __dirname,
        `../kline/${this.symbol}/${this.symbol}_data.json`
      );

      let dataInfo: DataAvailability;

      if (fs.existsSync(dataFilePath)) {
        try {
          const fileContent = await fs.promises.readFile(dataFilePath, 'utf8');
          if (!fileContent.trim()) {
            // File is empty, create new data info
            dataInfo = {
              symbol: this.symbol,
              firstAvailable: firstAvailable,
              lastAvailable: lastAvailable,
              timeframes: {},
              lastUpdated: new Date().toISOString()
            };
          } else {
            dataInfo = JSON.parse(fileContent);
          }
        } catch (parseError) {
          console.log(`Invalid JSON in data file for ${this.symbol}, creating new data info`);
          dataInfo = {
            symbol: this.symbol,
            firstAvailable: firstAvailable,
            lastAvailable: lastAvailable,
            timeframes: {},
            lastUpdated: new Date().toISOString()
          };
        }
      } else {
        dataInfo = {
          symbol: this.symbol,
          firstAvailable: firstAvailable,
          lastAvailable: lastAvailable,
          timeframes: {},
          lastUpdated: new Date().toISOString()
        };
      }

      // Update timeframe information
      dataInfo.timeframes[this.timeframe] = {
        downloaded: true,
        firstDownloaded: firstAvailable,
        lastDownloaded: lastAvailable
      };

      dataInfo.lastUpdated = new Date().toISOString();

      // Create symbol directory if it doesn't exist
      const symbolDir = path.join(__dirname, `../kline/${this.symbol}`);
      if (!fs.existsSync(symbolDir)) {
        await fs.promises.mkdir(symbolDir, { recursive: true });
      }

      // Save the updated information
      await fs.promises.writeFile(
        dataFilePath,
        JSON.stringify(dataInfo, null, 2)
      );

      console.log(`Updated data availability information for ${this.symbol}`);
    } catch (error) {
      console.error(`Error updating data availability for ${this.symbol}:`, error);
      // Don't throw error - allow process to continue even if data info update fails
    }
  }

  private async checkExistingData(): Promise<boolean> {
    const csvDir = path.join(
      __dirname,
      `../kline/${this.symbol}/${this.timeframe}/csv`
    );

    // Check if directory exists
    if (!fs.existsSync(csvDir)) {
      console.log(`No data directory found for ${this.symbol} - ${this.timeframe}`);
      return false;
    }

    const files = await fs.promises.readdir(csvDir);
    const csvFiles = files.filter(f => f.endsWith('.csv'));

    if (csvFiles.length === 0) {
      console.log(`No CSV files found for ${this.symbol} - ${this.timeframe}`);
      return false;
    }

    // Parse dates from filenames and check if we have all required months
    const datePattern = new RegExp(`${this.symbol}-${this.timeframe}-(\\d{4})-(\\d{2})`);
    const availableMonths = new Map<string, boolean>();

    for (const file of csvFiles) {
      const match = file.match(datePattern);
      if (match) {
        const yearMonth = `${match[1]}-${match[2]}`;
        availableMonths.set(yearMonth, true);
      }
    }

    // Check if all required months are present
    const startDate = new Date(
      this.runConfig.dataFetch.startDate.year,
      this.runConfig.dataFetch.startDate.month - 1
    );
    const endDate = this.runConfig.dataFetch.endDate
      ? new Date(
          this.runConfig.dataFetch.endDate.year,
          this.runConfig.dataFetch.endDate.month - 1
        )
      : new Date();

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const yearMonth = `${currentDate.getFullYear()}-${String(
        currentDate.getMonth() + 1
      ).padStart(2, '0')}`;
      
      if (!availableMonths.has(yearMonth)) {
        console.log(`Missing data for ${yearMonth} in ${this.symbol} - ${this.timeframe}`);
        return false;
      }

      // Check if file is empty or corrupted
      const matchingFile = csvFiles.find(f => f.includes(yearMonth));
      if (matchingFile) {
        const filePath = path.join(csvDir, matchingFile);
        const stats = await fs.promises.stat(filePath);
        if (stats.size === 0) {
          console.log(`Empty file found: ${matchingFile}`);
          return false;
        }
      }

      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    console.log(`✅ Found all required data for ${this.symbol} - ${this.timeframe}`);
    console.log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    return true;
  }

  async fetchHistoricalData(): Promise<void> {
    console.log(`\nChecking data availability for ${this.symbol} - ${this.timeframe}...`);
    
    // First check if we already have the required data
    if (await this.checkExistingData()) {
      console.log('Using existing data - all required files are present');
      return;
    }

    console.log('Missing or incomplete data, starting download...');
    await this.createDirectories();

    const basePath = `data/${this.runConfig.market.type}/${this.runConfig.market.subType}/monthly/klines/${this.symbol}/${this.timeframe}`;
    const fileNames = this.getMonthlyFileNames();

    console.log(`
Download Configuration:
----------------------
Symbol: ${this.symbol}
Market: ${this.runConfig.market.type} ${this.runConfig.market.subType}
Timeframe: ${this.timeframe}
Start Date: ${this.runConfig.dataFetch.startDate.year}-${this.runConfig.dataFetch.startDate.month}
End Date: ${this.runConfig.dataFetch.endDate?.year || 'current'}-${this.runConfig.dataFetch.endDate?.month || 'current'}
Files to check: ${fileNames.length}
    `);

    let firstAvailable: { year: number; month: number } | null = null;
    let lastAvailable: { year: number; month: number } | null = null;

    for (const fileName of fileNames) {
      const zipFileName = `${fileName}.zip`;
      const fileUrl = `${this.baseUrl}/${basePath}/${zipFileName}`;
      const zipPath = path.join(
        __dirname,
        `../kline/${this.symbol}/${this.timeframe}/zip/${zipFileName}`
      );

      try {
        console.log(`\nProcessing ${zipFileName}...`);
        const checksum = await this.downloadChecksum(fileUrl);
        
        await this.downloadFile(fileUrl, zipPath);

        if (checksum) {
          const isValid = await this.verifyChecksum(zipPath, checksum);
          if (!isValid) {
            console.warn(`Skipping ${zipFileName} due to checksum mismatch`);
            continue;
          }
        }

        await this.unzipFile(
          zipPath,
          path.join(__dirname, `../kline/${this.symbol}/${this.timeframe}/csv`)
        );

        console.log(`Successfully processed ${zipFileName}`);

        // Update data availability tracking
        const match = fileName.match(/(\d{4})-(\d{2})/);
        if (match) {
          const year = parseInt(match[1]);
          const month = parseInt(match[2]);
          
          if (!firstAvailable || year < firstAvailable.year || 
              (year === firstAvailable.year && month < firstAvailable.month)) {
            firstAvailable = { year, month };
          }
          
          if (!lastAvailable || year > lastAvailable.year ||
              (year === lastAvailable.year && month > lastAvailable.month)) {
            lastAvailable = { year, month };
          }
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          console.log(`File ${zipFileName} not found (might be a future month or too old)`);
          continue;
        }
        if (error instanceof Error) {
          console.error(`Error processing ${zipFileName}:`, error.message);
        } else {
          console.error(`Error processing ${zipFileName}:`, error);
        }
      }
    }

    if (firstAvailable && lastAvailable) {
      await this.updateDataAvailability(firstAvailable, lastAvailable);
    }

    console.log('Data download and extraction complete!');
  }
} 