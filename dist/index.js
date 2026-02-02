#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addPackages = addPackages;
exports.detectLibrary = detectLibrary;
const crawler_1 = require("./crawler/crawler");
const fingerprint_collector_1 = __importDefault(require("./fingerprint-collector"));
const lib_scorer_1 = require("./lib-scorer");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const merge_database_1 = require("./db-constructor/merge-database");
const lib_database_1 = require("./db-constructor/lib-database");
const fast_glob_1 = __importDefault(require("fast-glob"));
const semver_1 = __importDefault(require("semver"));
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const boxen_1 = __importDefault(require("boxen"));
const execAsync = util_1.default.promisify(child_process_1.exec);
const VERSION = '1.0.2';
const log = {
    info: (msg) => console.log(chalk_1.default.blue('ℹ'), msg),
    success: (msg) => console.log(chalk_1.default.green('✔'), msg),
    warn: (msg) => console.log(chalk_1.default.yellow('⚠'), msg),
    error: (msg) => console.log(chalk_1.default.red('✖'), msg),
    title: (msg) => console.log(chalk_1.default.bold.cyan(`\n${msg}\n`)),
    dim: (msg) => console.log(chalk_1.default.dim(msg)),
    box: (msg, options) => console.log((0, boxen_1.default)(msg, {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
        ...options,
    })),
};
function printHelp() {
    const title = chalk_1.default.bold.cyan('debun');
    const description = chalk_1.default.dim('Detecting Bundled JavaScript Libraries using Property-Order Graphs');
    console.log((0, boxen_1.default)(`${title}\n${description}`, {
        padding: 1,
        borderColor: 'cyan',
        borderStyle: 'round',
        textAlignment: 'center',
    }));
    console.log(`
${chalk_1.default.yellow.bold('📋 Commands:')}
  ${chalk_1.default.green('detect')} ${chalk_1.default.dim('<path>')}        Detect libraries from local JavaScript files/directory
  ${chalk_1.default.green('detect')} ${chalk_1.default.dim('-w <url>')}      Detect libraries from a web page URL
  ${chalk_1.default.green('add')} ${chalk_1.default.dim('<pkg>')}            Add a new package to the database
  ${chalk_1.default.green('reset')}                Reset the database to the original state
  ${chalk_1.default.green('list')}                 List all libraries in the database

${chalk_1.default.yellow.bold('⚙️  Options:')}
  ${chalk_1.default.dim('--save')}                     Save downloaded scripts to local files
  ${chalk_1.default.dim('-w, --web')}                  Treat input as a web URL
  ${chalk_1.default.dim('-v, --version')}              Show version
  ${chalk_1.default.dim('-h, --help')}                 Show help message

${chalk_1.default.yellow.bold('📝 Examples:')}
  ${chalk_1.default.dim('$')} debun detect ${chalk_1.default.cyan('./src/js')}
  ${chalk_1.default.dim('$')} debun detect -w ${chalk_1.default.cyan('https://example.com')}
  ${chalk_1.default.dim('$')} debun add ${chalk_1.default.cyan('lodash')}
  ${chalk_1.default.dim('$')} debun reset
`);
}
function printVersion() {
    console.log((0, boxen_1.default)(`${chalk_1.default.bold.cyan('debun')} ${chalk_1.default.yellow('v' + VERSION)}`, {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        borderColor: 'cyan',
        borderStyle: 'round',
    }));
}
function getLibNamesFromDb(dbDir) {
    const allLibs = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dbDir, 'all-libs.json'), 'utf-8'));
    const libNames = Object.values(allLibs)
        .map((lib) => lib.name)
        .sort();
    return libNames;
}
async function addPackages(packageNames) {
    function filterSemverOnly(versions) {
        return versions
            .filter((v) => v && semver_1.default.valid(v))
            .filter((v) => !semver_1.default.prerelease(v));
    }
    async function getAllVersions(pkgName) {
        const cmd = `npm view "${pkgName}" versions --json`;
        const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
        let versions = [];
        try {
            versions = JSON.parse(stdout.trim());
        }
        catch (err) {
            throw err;
        }
        if (!Array.isArray(versions)) {
            versions = [versions];
        }
        return filterSemverOnly(versions);
    }
    const dir = path_1.default.join(__dirname, 'temp');
    fs_1.default.mkdirSync(dir, { recursive: true });
    const Liblist = getLibNamesFromDb(path_1.default.join(__dirname, 'data'));
    let duplicateCount = 0;
    for (const packageName of packageNames) {
        if (Liblist.includes(packageName)) {
            duplicateCount++;
            console.log((0, boxen_1.default)(`Package ${chalk_1.default.bold(packageName)} already exists in the database, skipping...`, {
                padding: { top: 0, bottom: 0, left: 1, right: 1 },
                borderColor: 'yellow',
                borderStyle: 'round',
            }));
            continue;
        }
        const tempDir = path_1.default.join(dir, packageName.replace('@', '').replace('/', '-'));
        console.log((0, boxen_1.default)(`📦 ${chalk_1.default.bold(packageName)}`, {
            padding: { top: 0, bottom: 0, left: 1, right: 1 },
            borderColor: 'blue',
            borderStyle: 'round',
        }));
        const versionSpinner = (0, ora_1.default)({
            text: `Fetching versions for ${chalk_1.default.cyan(packageName)}...`,
            spinner: 'dots',
        }).start();
        try {
            const versions = await getAllVersions(packageName);
            versionSpinner.succeed(`Found ${chalk_1.default.bold(versions.length)} versions for ${chalk_1.default.cyan(packageName)}`);
            const downloadSpinner = (0, ora_1.default)({
                text: `Downloading ${packageName}...`,
                spinner: 'dots',
            }).start();
            let processed = 0;
            for (const version of versions) {
                const versionDir = path_1.default.join(tempDir, version);
                fs_1.default.mkdirSync(versionDir, { recursive: true });
                try {
                    const cmd = `cd "${dir}" && npm pack ${packageName}@${version}`;
                    await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
                    const tarballName = `${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;
                    const tarballPath = path_1.default.join(dir, tarballName);
                    const extractCmd = `tar -xzf "${tarballPath}" -C "${versionDir}" --strip-components=1 && rm "${tarballPath}"`;
                    await execAsync(extractCmd, { maxBuffer: 1024 * 1024 * 10 });
                    processed++;
                    downloadSpinner.text = `Downloading ${packageName}... ${chalk_1.default.dim(`(${processed}/${versions.length})`)} ${chalk_1.default.cyan(version)}`;
                }
                catch (err) {
                    // Skip failed versions silently
                }
            }
            downloadSpinner.succeed(`Downloaded ${chalk_1.default.bold(processed)}/${versions.length} versions`);
        }
        catch (err) {
            versionSpinner.fail(`Failed to get versions for ${packageName}: ${err.message}`);
        }
    }
    const buildSpinner = (0, ora_1.default)({
        text: 'Building database...',
        spinner: 'dots',
    }).start();
    const { allLibs, allHashes } = await (0, lib_database_1.buildDatabase)(dir);
    fs_1.default.rmSync(dir, { recursive: true, force: true });
    buildSpinner.text = 'Merging with existing database...';
    const dbDir = path_1.default.join(__dirname, 'data');
    const existingLibs = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dbDir, 'all-libs.json'), 'utf-8'));
    const existingHashes = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dbDir, 'all-hash.json'), 'utf-8'));
    const { mergedHashData, mergedLibData } = (0, merge_database_1.mergeDatabases)(existingHashes, existingLibs, allHashes, allLibs);
    fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-hash.json'), JSON.stringify(mergedHashData));
    fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-libs.json'), JSON.stringify(mergedLibData));
    if (duplicateCount === packageNames.length) {
        buildSpinner.info('No new packages were added to the database');
    }
    else {
        buildSpinner.succeed('Database updated successfully');
        console.log((0, boxen_1.default)(`Added ${chalk_1.default.bold(packageNames.length - duplicateCount)} package(s) to database`, {
            padding: { top: 0, bottom: 0, left: 1, right: 1 },
            borderColor: 'green',
            borderStyle: 'round',
        }));
    }
}
async function detectLibrary(urlOrpath, isWeb = false, save = false) {
    let filePaths = [];
    let mainFolder = '';
    const isFile = (() => {
        try {
            return fs_1.default.lstatSync(urlOrpath).isFile();
        }
        catch {
            return false;
        }
    })();
    console.log((0, boxen_1.default)(`🔍 ${chalk_1.default.bold('Scanning')}\n${chalk_1.default.dim(urlOrpath)}`, {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        borderColor: 'blue',
        borderStyle: 'round',
    }));
    const scanSpinner = (0, ora_1.default)({
        text: isWeb
            ? 'Downloading scripts from web...'
            : 'Scanning for JavaScript files...',
        spinner: 'dots',
    }).start();
    const startScanTime = process.hrtime.bigint();
    if (isWeb) {
        const { allFilePaths, domainFolder } = await (0, crawler_1.downloadScripts)(urlOrpath);
        filePaths = allFilePaths;
        mainFolder = domainFolder;
        const endScanTime = process.hrtime.bigint();
        const scanDuration = Number(endScanTime - startScanTime) / 1e9;
        scanSpinner.succeed(`Crawled ${chalk_1.default.bold(filePaths.length)} JavaScript file(s) in ${chalk_1.default.bold(scanDuration.toFixed(2))}s`);
    }
    else {
        if (isFile) {
            filePaths = [path_1.default.resolve(urlOrpath)];
        }
        else {
            filePaths = await (0, fast_glob_1.default)('**/*.{js,cjs,mjs}', {
                cwd: urlOrpath,
                absolute: true,
            });
            scanSpinner.succeed(`Found ${chalk_1.default.bold(filePaths.length)} JavaScript file(s)`);
        }
    }
    const startTime = process.hrtime.bigint();
    const analyzeSpinner = (0, ora_1.default)({
        text: 'Analyzing files...',
        spinner: 'dots',
    }).start();
    const mergeUnique = (target, source) => {
        for (const item of source) {
            if (!target.includes(item))
                target.push(item);
        }
    };
    const merged = new Map();
    for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        analyzeSpinner.text = `Analyzing files... ${chalk_1.default.dim(`(${i + 1}/${filePaths.length})`)}`;
        let raw;
        try {
            raw = fs_1.default.readFileSync(filePath, 'utf-8');
        }
        catch (e) {
            continue;
        }
        const fingerprints = (0, fingerprint_collector_1.default)(raw);
        const hashes = {};
        for (const fp of fingerprints) {
            if (!hashes[fp.nodes]) {
                hashes[fp.nodes] = [];
            }
            if (!hashes[fp.nodes].includes(fp.hash)) {
                hashes[fp.nodes].push(fp.hash);
            }
        }
        const scores = (0, lib_scorer_1.evaluate)(hashes, {
            SCORE_THRESHOLD: 0.2,
            MIN_FUNCTION_COUNT: 5,
        });
        for (const score of scores) {
            const existing = merged.get(score.libName);
            if (!existing) {
                merged.set(score.libName, { ...score });
                continue;
            }
            mergeUnique(existing.topVersions, score.topVersions);
            mergeUnique(existing.type2Versions, score.type2Versions);
            mergeUnique(existing.type3Versions, score.type3Versions);
        }
    }
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1e9;
    analyzeSpinner.succeed(`Analyzed in ${chalk_1.default.bold(duration.toFixed(2))}s`);
    const scores = [...merged.values()];
    console.log();
    if (scores.length === 0) {
        console.log((0, boxen_1.default)(`${chalk_1.default.yellow('⚠')} No libraries detected`, {
            padding: { top: 0, bottom: 0, left: 1, right: 1 },
            borderColor: 'yellow',
            borderStyle: 'round',
        }));
    }
    else {
        const resultLines = scores
            .map((score) => {
            const type3Version = score.type3Versions.join(', ');
            const type2Version = score.type2Versions.join(', ');
            const topVersion = score.topVersions.join(', ');
            const version = type3Version || type2Version || topVersion;
            const libName = score.libName === 'react-dom' ? 'react' : score.libName;
            return `  ${chalk_1.default.cyan('●')} ${chalk_1.default.bold(libName)} ${chalk_1.default.dim('@')} ${chalk_1.default.yellow(version)}`;
        })
            .join('\n');
        console.log((0, boxen_1.default)(`${chalk_1.default.bold.green('📚 Detected Libraries')}\n\n${resultLines}\n\n${chalk_1.default.dim(`Total: ${scores.length} library(ies)`)}`, {
            padding: 1,
            borderColor: 'green',
            borderStyle: 'round',
        }));
    }
    if (isWeb) {
        if (save) {
            log.success(`Downloaded scripts saved to ${chalk_1.default.underline(mainFolder)}`);
        }
        else {
            fs_1.default.rmSync(mainFolder, { recursive: true, force: true });
        }
    }
}
function parseArgs(argv) {
    const args = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-w' || arg === '--web') {
            flags.web = true;
        }
        else if (arg === '-v' || arg === '--version') {
            flags.version = true;
        }
        else if (arg === '-h' || arg === '--help') {
            flags.help = true;
        }
        else if (arg === '--save') {
            flags.save = true;
        }
        else if (!arg.startsWith('-')) {
            args.push(arg);
        }
    }
    return { args, flags };
}
async function main() {
    const { args, flags } = parseArgs(process.argv.slice(2));
    if (flags.version) {
        printVersion();
        return;
    }
    if (flags.help || args[0] === 'help') {
        printHelp();
        return;
    }
    const command = args[0];
    if (!command) {
        printHelp();
        process.exit(1);
    }
    switch (command) {
        case 'detect': {
            const target = args[1];
            if (!target) {
                console.log((0, boxen_1.default)(`${chalk_1.default.red('✖')} Missing target path or URL\n\n${chalk_1.default.dim('Usage: debun detect <path> or debun detect -w <url>')}`, {
                    padding: { top: 0, bottom: 0, left: 1, right: 1 },
                    borderColor: 'red',
                    borderStyle: 'round',
                }));
                process.exit(1);
            }
            await detectLibrary(target, flags.web, flags.save);
            break;
        }
        case 'add': {
            const packageNames = args.slice(1);
            if (packageNames.length === 0) {
                console.log((0, boxen_1.default)(`${chalk_1.default.red('✖')} Missing package name(s)\n\n${chalk_1.default.dim('Usage: debun add <package-name1> <package-name2> ...')}`, {
                    padding: { top: 0, bottom: 0, left: 1, right: 1 },
                    borderColor: 'red',
                    borderStyle: 'round',
                }));
                process.exit(1);
            }
            await addPackages(packageNames);
            break;
        }
        case 'reset': {
            const spinner = (0, ora_1.default)({
                text: 'Resetting database...',
                spinner: 'dots',
            }).start();
            const dbDir = path_1.default.join(__dirname, 'data');
            const originalHash = fs_1.default.readFileSync(path_1.default.join(dbDir, 'cache', 'all-hash.json'), 'utf-8');
            const originalLibs = fs_1.default.readFileSync(path_1.default.join(dbDir, 'cache', 'all-libs.json'), 'utf-8');
            fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-hash.json'), originalHash);
            fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-libs.json'), originalLibs);
            spinner.succeed('Database has been reset to the original state');
            break;
        }
        case 'list': {
            const spinner = (0, ora_1.default)({
                text: 'Loading library list...',
                spinner: 'dots',
            }).start();
            const dbDir = path_1.default.join(__dirname, 'data');
            const libNames = getLibNamesFromDb(dbDir);
            const outputPath = path_1.default.join(dbDir, 'library-list.txt');
            fs_1.default.writeFileSync(outputPath, libNames.join('\n') + '\n');
            spinner.succeed('Library list generated');
            console.log((0, boxen_1.default)(`Saved to ${chalk_1.default.underline(outputPath)}\n\n📦 ${chalk_1.default.bold(libNames.length)} libraries in database`, {
                padding: { top: 0, bottom: 0, left: 1, right: 1 },
                borderColor: 'green',
                borderStyle: 'round',
            }));
            break;
        }
        default: {
            console.log((0, boxen_1.default)(`${chalk_1.default.red('✖')} Unknown command: ${chalk_1.default.bold(command)}`, {
                padding: { top: 0, bottom: 0, left: 1, right: 1 },
                borderColor: 'red',
                borderStyle: 'round',
            }));
            printHelp();
            process.exit(1);
        }
    }
}
if (require.main === module) {
    main().catch((error) => {
        process.exit(1);
    });
}
