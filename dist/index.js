#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addPackage = addPackage;
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
  debun --version            Show version

Options:
  -w, --web                  Treat input as a web URL (for detect command)
  -h, --help                 Show help message

Examples:
  debun detect ./src/js
  debun detect -w https://example.com
  debun add lodash
`);
}
function printVersion() {
    console.log(`debun v${VERSION}`);
}
async function addPackage(packageName) {
    function filterSemverOnly(versions) {
        return versions
            .filter((v) => v && semver_1.default.valid(v))
            .filter((v) => !semver_1.default.prerelease(v));
    }
    async function getAllVersions(pkgName) {
        const cmd = `npm view "${pkgName}" versions --json`;
        console.log(`> ${cmd}`);
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
    console.log(`Adding package: ${packageName}`);
    function getInstalledPkgDir(baseDir, pkgName) {
        if (pkgName.startsWith('@')) {
            const [scope, name] = pkgName.split('/');
            return path_1.default.join(baseDir, 'node_modules', scope, name);
        }
        return path_1.default.join(baseDir, 'node_modules', pkgName);
    }
    try {
        const versions = await getAllVersions(packageName);
        console.log(`Found ${versions.length} versions for package ${packageName}`);
        for (const version of versions) {
            const tempDir = fs_1.default.mkdtempSync(path_1.default.join('/tmp', 'debun-'));
            try {
                const cmd = `cd "${tempDir}" && npm pack ${packageName}@${version}`;
                await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
                const tarballName = `${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;
                const tarballPath = path_1.default.join(tempDir, tarballName);
                const extractCmd = `tar -xzf "${tarballPath}" -C "${tempDir}"`;
                await execAsync(extractCmd, { maxBuffer: 1024 * 1024 * 10 });
                const pkgDir = getInstalledPkgDir(tempDir, `package${packageName.startsWith('@') ? `/${packageName.split('/')[1]}` : ''}`);
                const { allLibs, allHashes } = await (0, lib_database_1.buildDatabase)(pkgDir);
                const dbDir = path_1.default.join(__dirname, 'data');
                const existingLibs = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dbDir, 'all-libs.json'), 'utf-8'));
                const existingHashes = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dbDir, 'all-hash.json'), 'utf-8'));
                const { mergedHashData, mergedLibData } = (0, merge_database_1.mergeDatabases)(existingHashes, existingLibs, allHashes, allLibs);
                fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-hash.json'), JSON.stringify(mergedHashData, null, 2));
                fs_1.default.writeFileSync(path_1.default.join(dbDir, 'all-libs.json'), JSON.stringify(mergedLibData, null, 2));
            }
            finally {
                fs_1.default.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    }
    catch (err) {
        console.error(`Failed to get versions for package ${packageName}: ${err.message}`);
        return;
    }
}
async function detectLibrary(urlOrpath, isWeb = false) {
    let filePaths = [];
    if (isWeb) {
        filePaths = await (0, crawler_1.downloadScripts)(urlOrpath);
    }
    else {
        filePaths = await (0, fast_glob_1.default)('**/*.{js,cjs,mjs}', {
            cwd: urlOrpath,
            absolute: true,
        });
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
        return;
    }
    console.log('Detected libraries:');
    for (const score of scores) {
        const type3Version = score.type3Versions.join('@');
        const type2Version = score.type2Versions.join('@');
        const topVersion = score.topVersions.join('@');
        const version = type3Version || type2Version || topVersion;
        console.log(`  ${score.libName === 'react-dom' ? 'react' : score.libName}@${version}`);
    }
}
function parseArgs(argv) {
    const args = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-v' || arg === '--verbose') {
            flags.verbose = true;
        }
        else if (arg === '-w' || arg === '--web') {
            flags.web = true;
        }
        else if (arg === '--version') {
            flags.version = true;
        }
        else if (arg === '-h' || arg === '--help') {
            flags.help = true;
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
            await detectLibrary(target, flags.web);
            break;
        }
        case 'add': {
            const packageName = args[1];
            if (!packageName) {
                console.log('Usage: debun add <package-name>');
                process.exit(1);
            }
            await addPackage(packageName);
            break;
        }
        default: {
            if (fs_1.default.existsSync(command) ||
                command.startsWith('http://') ||
                command.startsWith('https://')) {
                await detectLibrary(command);
            }
            else {
                printHelp();
                process.exit(1);
            }
        }
    }
}
if (require.main === module) {
    main().catch((error) => {
        process.exit(1);
    });
}
