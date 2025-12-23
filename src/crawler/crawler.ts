import axios from 'axios';
import fs from 'fs';
import path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';

const logFilePath = path.join(__dirname, 'error-log.txt');

function logError(msg: string) {
  console.error(msg);
  fs.appendFile(logFilePath, msg + '\n', (fsErr) => {
    if (fsErr) console.error('Failed to write to log file:', fsErr);
  });
}

// To prevent `ENAMETOOLONG`

const MAX_LENGTH = 230;

function truncateFileName(fileName: string) {
  if (fileName.endsWith('/')) fileName = fileName.slice(0, -1);
  const ext = fileName.endsWith('.js') ? '.js' : '';
  const baseName = fileName.slice(0, -ext.length - 1);

  if (baseName.length > MAX_LENGTH - ext.length)
    return baseName.slice(0, MAX_LENGTH - ext.length) + ext;

  return fileName;
}

async function downloadFileFallback(url: string, filePath: string) {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(url);
  const content = await page.evaluate(() => document.body.innerText);
  await browser.close();
  fs.writeFileSync(filePath, content, 'utf8');
}

async function downloadFileFallback2(url: string, filePath: string) {
  try {
    console.log(`Fallback downloading: ${url}`);
    const response = await axios({
      method: 'get',
      url,
      responseType: 'arraybuffer', // Binary data
      timeout: 5000,
    });

    if (response.status >= 400) {
      throw new Error(`[${response.status}] ${response.statusText}`);
    }

    fs.writeFileSync(filePath, response.data);
    console.log(`Fallback saved: ${filePath}`);
  } catch (err) {
    console.error(`Fallback download failed: ${(err as any).message}`);
  }
}

async function downloadFile(url: string, filePath: string) {
  return new Promise((resolve: (value: unknown) => void) => {
    console.log(`Downloading: ${url}`);
    axios({
      method: 'get',
      url,
      responseType: 'stream',
      timeout: 5000, // 5 seconds
    })
      .then((response) => {
        if (response.status < 400) {
          const file = fs.createWriteStream(filePath);
          response.data.pipe(file);
          file.on('finish', () => {
            file.close(() => {
              console.log(`Saved: ${filePath}`);
              resolve(true);
            });
          });
          file.on('error', (err) => {
            fs.unlinkSync(filePath);
            throw new Error(err as any);
          });
        } else throw new Error(`[${response.status}] ${response.statusText}`);
      })
      .catch((err) => {
        downloadFileFallback2(url, filePath)
          .then(() => resolve(true))
          .catch((err2) => {
            logError(
              `Error downloading file "${url}": ${err2.message || err2}`
            );
            resolve(false);
          });
      });
  });
}

async function interceptRequests(page: Page, jsFiles: Set<string>) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const requestUrl = request.url();
    if (request.resourceType() === 'script') {
      jsFiles.add(requestUrl);
    }
    request.continue();
  });
}

function getPreloadScripts(page: Page) {
  return page.evaluate(() => {
    const links = [
      ...document.querySelectorAll('link[rel="preload"][as="script"]'),
      ...document.querySelectorAll('link[rel="modulepreload"]'),
    ];
    return links.map((link) => (link as HTMLLinkElement).href);
  });
}

function getInlineScripts(page: Page) {
  return page.evaluate(() => {
    const scriptElements = Array.from(document.querySelectorAll('script'));
    return scriptElements
      .filter((script) => !script.src && script?.textContent?.trim())
      .map((script) => script.textContent ?? '');
  });
}

function guardFolderSync(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function encodeFileNameOnly(path: string) {
  const parts = path.split('/');
  const fileName = encodeURIComponent(parts.pop() ?? '');
  return [...parts, fileName].join('/');
}

async function downloadScripts(
  targetUrl: string,
  headless: boolean = true,
  rootFolder: string = 'data/crawled'
) {
  console.time(`Download-${targetUrl}`);
  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      headless,
      args: ['--no-sandbox'],
      executablePath: '/usr/bin/chromium',
    });
  } catch (error) {
    browser = await puppeteer.launch({
      headless,
    });
  }

  const page = await browser.newPage();

  const jsFiles: Set<string> = new Set();

  await interceptRequests(page, jsFiles);

  const reachableUrl = new URL(
    targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`
  );
  await page.goto(reachableUrl.toString(), {
    waitUntil: 'networkidle2',
    timeout: 90000,
  });

  const preloadScripts = await getPreloadScripts(page);
  preloadScripts.forEach((scriptUrl) => jsFiles.add(scriptUrl));

  const inlineScripts = await getInlineScripts(page);
  await browser.close();

  const domainFolder = path.join(
    __dirname,
    '../',
    rootFolder,
    reachableUrl.host
  );
  guardFolderSync(domainFolder);

  inlineScripts.forEach((inlineScript, idx) => {
    const filepath = path.join(domainFolder, `browser-script-${idx}.js`);
    fs.writeFileSync(filepath, inlineScript, 'utf8');
  });

  console.log(`Found ${jsFiles.size} JS files. Downloading...`);

  const errorUrls = [];
  const allFilePaths: string[] = [];
  for (const fileUrl of jsFiles) {
    try {
      const filePath = truncateFileName(
        encodeFileNameOnly(fileUrl.replace(/https?:\/\//, ''))
      );
      const fullFilePath = path.join(domainFolder, filePath);
      allFilePaths.push(fullFilePath);
      guardFolderSync(path.dirname(fullFilePath));
      await downloadFile(fileUrl, fullFilePath);
    } catch (error) {
      const errorMessage = `Failed to download: ${fileUrl} - ${error}\n`;
      logError(errorMessage);
      errorUrls.push(fileUrl);
    }
  }

  console.log(`All JS files saved to ${domainFolder}`);
  if (errorUrls.length > 0)
    console.log(
      `However, there were errors downloading the following ${
        errorUrls.length
      } files:\n
          -${errorUrls.join('\n-')}`
    );
  console.timeEnd(`Download-${targetUrl}`);
  return allFilePaths;
}

export { downloadScripts };
