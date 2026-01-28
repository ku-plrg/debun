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

export async function addPackage(packageName: string) {
  function filterSemverOnly(versions: string[]) {
    return versions
      .filter((v: string) => v && semver.valid(v))
      .filter((v) => !semver.prerelease(v));
  }
  async function getAllVersions(pkgName: string) {
    const cmd = `npm view "${pkgName}" versions --json`;
    console.log(`> ${cmd}`);

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
  console.log(`Adding package: ${packageName}`);
  function getInstalledPkgDir(baseDir: string, pkgName: string) {
    if (pkgName.startsWith('@')) {
      const [scope, name] = pkgName.split('/');
      return path.join(baseDir, 'node_modules', scope, name);
    }
    return path.join(baseDir, 'node_modules', pkgName);
  }

  try {
    const versions = await getAllVersions(packageName);
    console.log(`Found ${versions.length} versions for package ${packageName}`);
    for (const version of versions) {
      const tempDir = fs.mkdtempSync(path.join('/tmp', 'debun-'));
      try {
        const cmd = `cd "${tempDir}" && npm pack ${packageName}@${version}`;
        await execAsync(cmd, { maxBuffer: 1024 * 1024 * 10 });

        const tarballName = `${packageName.replace('@', '').replace('/', '-')}-${version}.tgz`;
        const tarballPath = path.join(tempDir, tarballName);
        const extractCmd = `tar -xzf "${tarballPath}" -C "${tempDir}"`;
        await execAsync(extractCmd, { maxBuffer: 1024 * 1024 * 10 });

        const pkgDir = getInstalledPkgDir(
          tempDir,
          `package${packageName.startsWith('@') ? `/${packageName.split('/')[1]}` : ''}`
        );
        const { allLibs, allHashes } = await buildDatabase(pkgDir);
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
        fs.writeFileSync(
          path.join(dbDir, 'all-hash.json'),
          JSON.stringify(mergedHashData, null, 2)
        );
        fs.writeFileSync(
          path.join(dbDir, 'all-libs.json'),
          JSON.stringify(mergedLibData, null, 2)
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  } catch (err) {
    console.error(
      `Failed to get versions for package ${packageName}: ${(err as any).message}`
    );
    return;
  }
}
export async function detectLibrary(urlOrpath: string, isWeb: boolean = false) {
  let filePaths: string[] = [];

  if (isWeb) {
    filePaths = await downloadScripts(urlOrpath);
  } else {
    filePaths = await fg('**/*.{js,cjs,mjs}', {
      cwd: urlOrpath,
      absolute: true,
    });
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
    return;
  }
  console.log('Detected libraries:');
  for (const score of scores) {
    const type3Version = score.type3Versions.join('@');
    const type2Version = score.type2Versions.join('@');
    const topVersion = score.topVersions.join('@');
    const version = type3Version || type2Version || topVersion;
    console.log(
      `  ${score.libName === 'react-dom' ? 'react' : score.libName}@${version}`
    );
  }
}

function parseArgs(argv: string[]) {
  const args: string[] = [];
  const flags: Record<string, boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-v' || arg === '--verbose') {
      flags.verbose = true;
    } else if (arg === '-w' || arg === '--web') {
      flags.web = true;
    } else if (arg === '--version') {
      flags.version = true;
    } else if (arg === '-h' || arg === '--help') {
      flags.help = true;
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
      if (
        fs.existsSync(command) ||
        command.startsWith('http://') ||
        command.startsWith('https://')
      ) {
        await detectLibrary(command);
      } else {
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
