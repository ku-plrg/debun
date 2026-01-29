import axios from 'axios';
import fs from 'fs';
import path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';

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
  try {
    const response = await axios({
      method: 'get',
      url,
      responseType: 'arraybuffer',
      timeout: 5000,
    });

    if (response.status >= 400) {
      throw new Error(`[${response.status}] ${response.statusText}`);
    }

    fs.writeFileSync(filePath, response.data);
  } catch (err) {}
}

async function downloadFile(url: string, filePath: string) {
  return new Promise((resolve: (value: unknown) => void) => {
    axios({
      method: 'get',
      url,
      responseType: 'stream',
      timeout: 5000,
    })
      .then((response) => {
        if (response.status < 400) {
          const file = fs.createWriteStream(filePath);
          response.data.pipe(file);
          file.on('finish', () => {
            file.close(() => {
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
        downloadFileFallback(url, filePath)
          .then(() => resolve(true))
          .catch((err2) => {
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
  try {
    await page.goto(reachableUrl.toString(), {
      waitUntil: 'networkidle2',
      timeout: 90000,
    });
  } catch (err) {}

  const preloadScripts = await getPreloadScripts(page);
  preloadScripts.forEach((scriptUrl) => jsFiles.add(scriptUrl));

  await browser.close();

  const domainFolder = path.join(
    __dirname,
    '../',
    rootFolder,
    reachableUrl.host
  );
  guardFolderSync(domainFolder);
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
    } catch (error) {}
  }
  return { allFilePaths, domainFolder };
}

export { downloadScripts };
