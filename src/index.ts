#!/usr/bin/env node

import { Score } from './types/types';
import { downloadScripts } from './crawler/crawler';
import fingerprintCollector from './fingerprint-collector';
import { evaluate } from './lib-scorer';
import fs from 'fs';
import path from 'path';

const VERSION = '1.0.2';

function printHelp() {
  console.log(`
debun - Detecting Bundled JavaScript Libraries on Web using Property-Order Graphs

Usage:
  debun detect <path>        Detect libraries from local JavaScript files/directory
  debun detect -w <url>      Detect libraries from a web page URL
  debun add <pkg>            Add a new package to the database
  debun help                 Show this help message
  debun --version            Show version

Options:
  -v, --verbose              Enable verbose output
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

export async function detectLibrary(urlOrpath: string, isWeb: boolean = false) {
  let filePaths: string[] = [];

  if (
    isWeb ||
    urlOrpath.startsWith('http://') ||
    urlOrpath.startsWith('https://')
  ) {
    filePaths = await downloadScripts(urlOrpath);
  } else {
    const collectFilesRecursively = (p: string): string[] => {
      const stat = fs.statSync(p);
      if (stat.isFile()) return [p];
      return fs.readdirSync(p, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(p, entry.name);
        if (entry.isDirectory()) return collectFilesRecursively(fullPath);
        if (entry.isFile() && fullPath.endsWith('.js')) return [fullPath];
        return [];
      });
    };
    filePaths = collectFilesRecursively(urlOrpath);
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
