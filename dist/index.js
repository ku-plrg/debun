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
const execAsync = util_1.default.promisify(child_process_1.exec);
const VERSION = '1.0.2';
function printHelp() {
    console.log(`
debun - Detecting Bundled JavaScript Libraries on Web using Property-Order Graphs

Usage:
  debun detect <path>        Detect libraries from local JavaScript files/directory
  debun detect -w <url>      Detect libraries from a web page URL
  debun add <pkg>            Add a new package to the database
  debun reset                Reset the database to the original state
  debun -v, --version        Show version
  debun -h, --help           Show help message

Options:
  --save                     Save downloaded scripts to local files (for detect command)
  -w, --web                  Treat input as a web URL (for detect command)

Examples:
  debun detect ./src/js
  debun detect -w https://example.com
  debun add lodash
  debun reset
`);
}
function printVersion() {
    console.log(`debun v${VERSION}`);
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
            console.error(`versions JSON parse fail: ${pkgName}`);
            throw err;
        }
        if (!Array.isArray(versions)) {
            versions = [versions];
        }
        return filterSemverOnly(versions);
    }
    const dir = path_1.default.join(__dirname, 'temp');
    fs_1.default.mkdirSync(dir, { recursive: true });
    for (const packageName of packageNames) {
        const tempDir = path_1.default.join(dir, packageName.replace('/', '_'));
        console.log(`Adding package: ${packageName}`);
        try {
            const versions = await getAllVersions(packageName);
            console.log(`Found ${versions.length} versions for package ${packageName}`);
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
                }
                catch (err) {
                    console.error(`Failed to process ${packageName}@${version}: ${err.message}`);
                }
            }
        }
        catch (err) {
            console.error(`Failed to get versions for package ${packageName}: ${err.message}`);
        }
    }
    const { allLibs, allHashes } = await (0, lib_database_1.buildDatabase)(dir);
    fs_1.default.rmSync(dir, { recursive: true, force: true });
    const dbDir = path_1.default.join(__dirname, 'data');
    const existingLibs = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dbDir, 'all-libs.json'), 'utf-8'));
    const existingHashes = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dbDir, 'all-hash.json'), 'utf-8'));
    const { mergedHashData, mergedLibData } = (0, merge_database_1.mergeDatabases)(existingHashes, existingLibs, allHashes, allLibs);
    console.log('Database updated successfully.');
    fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-hash.json'), JSON.stringify(mergedHashData));
    fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-libs.json'), JSON.stringify(mergedLibData));
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
    if (isWeb) {
        const { allFilePaths, domainFolder } = await (0, crawler_1.downloadScripts)(urlOrpath);
        filePaths = allFilePaths;
        mainFolder = domainFolder;
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
        }
    }
    const mergeUnique = (target, source) => {
        for (const item of source) {
            if (!target.includes(item))
                target.push(item);
        }
    };
    const merged = new Map();
    for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
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
    const scores = [...merged.values()];
    if (scores.length === 0) {
        console.log('No libraries detected.');
    }
    else {
        console.log('Detected libraries:');
        for (const score of scores) {
            const type3Version = score.type3Versions.join('@');
            const type2Version = score.type2Versions.join('@');
            const topVersion = score.topVersions.join('@');
            const version = type3Version || type2Version || topVersion;
            console.log(`${score.libName}@${version}`);
        }
    }
    if (isWeb && !save) {
        fs_1.default.rmSync(mainFolder, { recursive: true, force: true });
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
                console.log('Usage: debun detect <path> or debun detect -w <url>');
                process.exit(1);
            }
            await detectLibrary(target, flags.web, flags.save);
            break;
        }
        case 'add': {
            const packageNames = args.slice(1);
            if (packageNames.length === 0) {
                console.log('Usage: debun add <package-name1> <package-name2> ...');
                process.exit(1);
            }
            await addPackages(packageNames);
            break;
        }
        case 'reset': {
            const dbDir = path_1.default.join(__dirname, 'data');
            const originalHash = fs_1.default.readFileSync(path_1.default.join(dbDir, 'cache', 'all-hash.json'), 'utf-8');
            const originalLibs = fs_1.default.readFileSync(path_1.default.join(dbDir, 'cache', 'all-libs.json'), 'utf-8');
            fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-hash.json'), originalHash);
            fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-libs.json'), originalLibs);
            console.log('Database has been reset to the original state.');
            break;
        }
        default: {
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
