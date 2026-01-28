"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadScripts = downloadScripts;
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const puppeteer_1 = __importDefault(require("puppeteer"));
// To prevent `ENAMETOOLONG`
const MAX_LENGTH = 230;
function truncateFileName(fileName) {
    if (fileName.endsWith('/'))
        fileName = fileName.slice(0, -1);
    const ext = fileName.endsWith('.js') ? '.js' : '';
    const baseName = fileName.slice(0, -ext.length - 1);
    if (baseName.length > MAX_LENGTH - ext.length)
        return baseName.slice(0, MAX_LENGTH - ext.length) + ext;
    return fileName;
}
async function downloadFileFallback(url, filePath) {
    const browser = await puppeteer_1.default.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto(url);
    const content = await page.evaluate(() => document.body.innerText);
    await browser.close();
    fs_1.default.writeFileSync(filePath, content, 'utf8');
}
async function downloadFileFallback2(url, filePath) {
    try {
        const response = await (0, axios_1.default)({
            method: 'get',
            url,
            responseType: 'arraybuffer',
            timeout: 5000,
        });
        if (response.status >= 400) {
            throw new Error(`[${response.status}] ${response.statusText}`);
        }
        fs_1.default.writeFileSync(filePath, response.data);
    }
    catch (err) { }
}
async function downloadFile(url, filePath) {
    return new Promise((resolve) => {
        (0, axios_1.default)({
            method: 'get',
            url,
            responseType: 'stream',
            timeout: 5000,
        })
            .then((response) => {
            if (response.status < 400) {
                const file = fs_1.default.createWriteStream(filePath);
                response.data.pipe(file);
                file.on('finish', () => {
                    file.close(() => {
                        resolve(true);
                    });
                });
                file.on('error', (err) => {
                    fs_1.default.unlinkSync(filePath);
                    throw new Error(err);
                });
            }
            else
                throw new Error(`[${response.status}] ${response.statusText}`);
        })
            .catch((err) => {
            downloadFileFallback2(url, filePath)
                .then(() => resolve(true))
                .catch((err2) => {
                resolve(false);
            });
        });
    });
}
async function interceptRequests(page, jsFiles) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const requestUrl = request.url();
        if (request.resourceType() === 'script') {
            jsFiles.add(requestUrl);
        }
        request.continue();
    });
}
function getPreloadScripts(page) {
    return page.evaluate(() => {
        const links = [
            ...document.querySelectorAll('link[rel="preload"][as="script"]'),
            ...document.querySelectorAll('link[rel="modulepreload"]'),
        ];
        return links.map((link) => link.href);
    });
}
function getInlineScripts(page) {
    return page.evaluate(() => {
        const scriptElements = Array.from(document.querySelectorAll('script'));
        return scriptElements
            .filter((script) => !script.src && script?.textContent?.trim())
            .map((script) => script.textContent ?? '');
    });
}
function guardFolderSync(dirPath) {
    if (!fs_1.default.existsSync(dirPath))
        fs_1.default.mkdirSync(dirPath, { recursive: true });
}
function encodeFileNameOnly(path) {
    const parts = path.split('/');
    const fileName = encodeURIComponent(parts.pop() ?? '');
    return [...parts, fileName].join('/');
}
async function downloadScripts(targetUrl, headless = true, rootFolder = 'data/crawled') {
    let browser;
    try {
        browser = await puppeteer_1.default.launch({
            headless,
            args: ['--no-sandbox'],
            executablePath: '/usr/bin/chromium',
        });
    }
    catch (error) {
        browser = await puppeteer_1.default.launch({
            headless,
        });
    }
    const page = await browser.newPage();
    const jsFiles = new Set();
    await interceptRequests(page, jsFiles);
    const reachableUrl = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
    try {
        await page.goto(reachableUrl.toString(), {
            waitUntil: 'networkidle2',
            timeout: 90000,
        });
    }
    catch (err) { }
    const preloadScripts = await getPreloadScripts(page);
    preloadScripts.forEach((scriptUrl) => jsFiles.add(scriptUrl));
    const inlineScripts = await getInlineScripts(page);
    await browser.close();
    const domainFolder = path_1.default.join(__dirname, '../', rootFolder, reachableUrl.host);
    guardFolderSync(domainFolder);
    inlineScripts.forEach((inlineScript, idx) => {
        const filepath = path_1.default.join(domainFolder, `browser-script-${idx}.js`);
        fs_1.default.writeFileSync(filepath, inlineScript, 'utf8');
    });
    const allFilePaths = [];
    let downloadedCount = 0;
    for (const fileUrl of jsFiles) {
        try {
            const filePath = truncateFileName(encodeFileNameOnly(fileUrl.replace(/https?:\/\//, '')));
            const fullFilePath = path_1.default.join(domainFolder, filePath);
            allFilePaths.push(fullFilePath);
            guardFolderSync(path_1.default.dirname(fullFilePath));
            await downloadFile(fileUrl, fullFilePath);
            downloadedCount++;
            if (jsFiles.size > 5) {
            }
        }
        catch (error) { }
    }
    return allFilePaths;
}
