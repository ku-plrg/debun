#!/usr/bin/env node

import { LibData, Score } from './types/types';
import { downloadScripts } from './crawler/crawler';
import fingerprintCollector from './fingerprint-collector';
import { evaluate } from './lib-scorer';
import fs from 'fs';
import path from 'path';
import { mergeDatabases } from './db-constructor/merge-database';
import { buildDatabase } from './db-constructor/lib-database';
import fg from 'fast-glob';
import semver from 'semver';
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);

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
`);
}

function printVersion() {
  console.log(`debun v${VERSION}`);
}

export async function addPackages(packageNames: string[]) {
  function filterSemverOnly(versions: string[]) {
    return versions
      .filter((v: string) => v && semver.valid(v))
      .filter((v) => !semver.prerelease(v));
  }
  async function getAllVersions(pkgName: string) {
    const cmd = `npm view "${pkgName}" versions --json`;

    const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });
    let versions = [];

    try {
      versions = JSON.parse(stdout.trim());
    } catch (err) {
      console.error(`versions JSON parse fail: ${pkgName}`);
      throw err;
    }

    if (!Array.isArray(versions)) {
      versions = [versions];
    }

    return filterSemverOnly(versions);
  }
  const dir = path.join(__dirname, 'temp');
  fs.mkdirSync(dir, { recursive: true });

  for (const packageName of packageNames) {
    const tempDir = path.join(dir, packageName.replace('/', '_'));
    console.log(`Adding package: ${packageName}`);

    try {
      const versions = await getAllVersions(packageName);
      console.log(
        `Found ${versions.length} versions for package ${packageName}`
      );
      for (const version of versions) {
        const versionDir = path.join(tempDir, version);
        fs.mkdirSync(versionDir, { recursive: true });
        try {
          const cmd = `cd "${dir}" && npm pack ${packageName}@${version}`;
          await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });

          const tarballName = `${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;
          const tarballPath = path.join(dir, tarballName);
          const extractCmd = `tar -xzf "${tarballPath}" -C "${versionDir}" --strip-components=1 && rm "${tarballPath}"`;
          await execAsync(extractCmd, { maxBuffer: 1024 * 1024 * 10 });
        } catch (err) {
          console.error(
            `Failed to process ${packageName}@${version}: ${(err as any).message}`
          );
        }
      }
    } catch (err) {
      console.error(
        `Failed to get versions for package ${packageName}: ${(err as any).message}`
      );
    }
  }

  const { allLibs, allHashes } = await buildDatabase(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  const dbDir = path.join(__dirname, 'data');
  const existingLibs: LibData = JSON.parse(
    fs.readFileSync(path.join(dbDir, 'all-libs.json'), 'utf-8')
  );
  const existingHashes: any = JSON.parse(
    fs.readFileSync(path.join(dbDir, 'all-hash.json'), 'utf-8')
  );

  const { mergedHashData, mergedLibData } = mergeDatabases(
    existingHashes,
    existingLibs,
    allHashes,
    allLibs
  );
  console.log('Database updated successfully.');
  fs.writeFileSync(
    path.join(dbDir, 'all-hash.json'),
    JSON.stringify(mergedHashData)
  );
  fs.writeFileSync(
    path.join(dbDir, 'all-libs.json'),
    JSON.stringify(mergedLibData)
  );
}
export async function detectLibrary(
  urlOrpath: string,
  isWeb: boolean = false,
  save: boolean = false
) {
  let filePaths: string[] = [];
  let mainFolder = '';

  const isFile = (() => {
    try {
      return fs.lstatSync(urlOrpath).isFile();
    } catch {
      return false;
    }
  })();

  if (isWeb) {
    const { allFilePaths, domainFolder } = await downloadScripts(urlOrpath);
    filePaths = allFilePaths;
    mainFolder = domainFolder;
  } else {
    if (isFile) {
      filePaths = [path.resolve(urlOrpath)];
    } else {
      filePaths = await fg('**/*.{js,cjs,mjs}', {
        cwd: urlOrpath,
        absolute: true,
      });
    }
  }

  const mergeUnique = (target: string[], source: string[]) => {
    for (const item of source) {
      if (!target.includes(item)) target.push(item);
    }
  };
  const merged = new Map<string, Score>();

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      continue;
    }
    const fingerprints = fingerprintCollector(raw);
    const hashes: Record<number, string[]> = {};
    for (const fp of fingerprints) {
      if (!hashes[fp.nodes]) {
        hashes[fp.nodes] = [];
      }
      if (!hashes[fp.nodes].includes(fp.hash)) {
        hashes[fp.nodes].push(fp.hash);
      }
    }

    const scores = evaluate(hashes, {
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
  } else {
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
    fs.rmSync(mainFolder, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]) {
  const args: string[] = [];
  const flags: Record<string, boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-w' || arg === '--web') {
      flags.web = true;
    } else if (arg === '-v' || arg === '--version') {
      flags.version = true;
    } else if (arg === '-h' || arg === '--help') {
      flags.help = true;
    } else if (arg === '--save') {
      flags.save = true;
    } else if (!arg.startsWith('-')) {
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
      const dbDir = path.join(__dirname, 'data');
      const originalHash = fs.readFileSync(
        path.join(dbDir, 'cache', 'all-hash.json'),
        'utf-8'
      );
      const originalLibs = fs.readFileSync(
        path.join(dbDir, 'cache', 'all-libs.json'),
        'utf-8'
      );
      fs.writeFileSync(path.join(dbDir, 'all-hash.json'), originalHash);
      fs.writeFileSync(path.join(dbDir, 'all-libs.json'), originalLibs);
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
