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
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
const execAsync = util.promisify(exec);

const VERSION = '1.0.2';

function printHelp() {
  const title = chalk.bold.cyan('debun');
  const description = chalk.dim(
    'Detecting Bundled JavaScript Libraries using Property-Order Graphs'
  );

  console.log(
    boxen(`${title}\n${description}`, {
      padding: 1,
      borderColor: 'cyan',
      borderStyle: 'round',
      textAlignment: 'center',
    })
  );

  console.log(`
${chalk.yellow.bold('📋 Commands:')}
  ${chalk.green('detect')} ${chalk.dim('<path>')}        Detect libraries from local JavaScript files/directory
  ${chalk.green('detect')} ${chalk.dim('-w <url>')}      Detect libraries from a web page URL
  ${chalk.green('add')} ${chalk.dim('<pkg>')}            Add a new package to the database
  ${chalk.green('reset')}                Reset the database to the original state
  ${chalk.green('list')}                 List all libraries in the database

${chalk.yellow.bold('⚙️  Options:')}
  ${chalk.dim('--save')}                     Save downloaded scripts to local files
  ${chalk.dim('-w, --web')}                  Treat input as a web URL
  ${chalk.dim('-v, --version')}              Show version
  ${chalk.dim('-h, --help')}                 Show help message

${chalk.yellow.bold('📝 Examples:')}
  ${chalk.dim('$')} debun detect ${chalk.cyan('./src/js')}
  ${chalk.dim('$')} debun detect -w ${chalk.cyan('https://example.com')}
  ${chalk.dim('$')} debun add ${chalk.cyan('lodash')}
  ${chalk.dim('$')} debun reset
`);
}

function printVersion() {
  console.log(
    boxen(`${chalk.bold.cyan('debun')} ${chalk.yellow('v' + VERSION)}`, {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderColor: 'cyan',
      borderStyle: 'round',
    })
  );
}
function getLibNamesFromDb(dbDir: string): string[] {
  const allLibs: LibData = JSON.parse(
    fs.readFileSync(path.join(dbDir, 'all-libs.json'), 'utf-8')
  );
  const libNames = Object.values(allLibs)
    .map((lib) => lib.name)
    .sort();
  return libNames;
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
      throw err;
    }

    if (!Array.isArray(versions)) {
      versions = [versions];
    }

    return filterSemverOnly(versions);
  }

  const dir = path.join(__dirname, 'temp');
  fs.mkdirSync(dir, { recursive: true });
  const Liblist = getLibNamesFromDb(path.join(__dirname, 'data'));
  let duplicateCount = 0;
  for (const packageName of packageNames) {
    if (Liblist.includes(packageName)) {
      duplicateCount++;
      console.log(
        boxen(
          `${chalk.yellow('⚠')} Package ${chalk.bold(
            packageName
          )} already exists in the database, skipping...`,
          {
            padding: { top: 0, bottom: 0, left: 1, right: 1 },
            borderColor: 'yellow',
            borderStyle: 'round',
          }
        )
      );
      continue;
    }
    const tempDir = path.join(
      dir,
      packageName.replace('@', '').replace('/', '-')
    );

    console.log(
      boxen(`📦 ${chalk.bold(packageName)}`, {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        borderColor: 'blue',
        borderStyle: 'round',
      })
    );

    const versionSpinner = ora({
      text: `Fetching versions for ${chalk.cyan(packageName)}...`,
      spinner: 'dots',
    }).start();

    try {
      const versions = await getAllVersions(packageName);
      versionSpinner.succeed(
        `Found ${chalk.bold(versions.length)} versions for ${chalk.cyan(packageName)}`
      );

      const downloadSpinner = ora({
        text: `Downloading ${packageName}...`,
        spinner: 'dots',
      }).start();

      let processed = 0;
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
          processed++;
          downloadSpinner.text = `Downloading ${packageName}... ${chalk.dim(`(${processed}/${versions.length})`)} ${chalk.cyan(version)}`;
        } catch (err) {
          // Skip failed versions silently
        }
      }
      downloadSpinner.succeed(
        `Downloaded ${chalk.bold(processed)}/${versions.length} versions`
      );
    } catch (err) {
      versionSpinner.fail(
        `Failed to get versions for ${packageName}: ${(err as any).message}`
      );
    }
  }

  const buildSpinner = ora({
    text: 'Building database...',
    spinner: 'dots',
  }).start();

  const { allLibs, allHashes } = await buildDatabase(dir);
  fs.rmSync(dir, { recursive: true, force: true });

  buildSpinner.text = 'Merging with existing database...';

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
    JSON.stringify(mergedHashData)
  );
  fs.writeFileSync(
    path.join(dbDir, 'all-libs.json'),
    JSON.stringify(mergedLibData)
  );
  if (duplicateCount === packageNames.length) {
    buildSpinner.info('No new packages were added to the database');
  } else {
    buildSpinner.succeed('Database updated successfully');

    console.log(
      boxen(
        `${chalk.green('✔')} Added ${chalk.bold(packageNames.length - duplicateCount)} package(s) to database`,
        {
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          borderColor: 'green',
          borderStyle: 'round',
        }
      )
    );
  }
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

  console.log(
    boxen(`🔍 ${chalk.bold('Scanning')}\n${chalk.dim(urlOrpath)}`, {
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      borderColor: 'blue',
      borderStyle: 'round',
    })
  );

  const scanSpinner = ora({
    text: isWeb
      ? 'Downloading scripts from web...'
      : 'Scanning for JavaScript files...',
    spinner: 'dots',
  }).start();
  const startScanTime = process.hrtime.bigint();
  if (isWeb) {
    const { allFilePaths, domainFolder } = await downloadScripts(urlOrpath);
    filePaths = allFilePaths;
    mainFolder = domainFolder;
    const endScanTime = process.hrtime.bigint();
    const scanDuration = Number(endScanTime - startScanTime) / 1e9;
    scanSpinner.succeed(
      `Crawled ${chalk.bold(filePaths.length)} JavaScript file(s) in ${chalk.bold(scanDuration.toFixed(2))}s`
    );
  } else {
    if (isFile) {
      filePaths = [path.resolve(urlOrpath)];
    } else {
      filePaths = await fg('**/*.{js,cjs,mjs}', {
        cwd: urlOrpath,
        absolute: true,
      });
      scanSpinner.succeed(
        `Found ${chalk.bold(filePaths.length)} JavaScript file(s)`
      );
    }
  }

  const startTime = process.hrtime.bigint();
  const analyzeSpinner = ora({
    text: 'Analyzing files...',
    spinner: 'dots',
  }).start();

  const mergeUnique = (target: string[], source: string[]) => {
    for (const item of source) {
      if (!target.includes(item)) target.push(item);
    }
  };
  const merged = new Map<string, Score>();

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    analyzeSpinner.text = `Analyzing files... ${chalk.dim(`(${i + 1}/${filePaths.length})`)}`;

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

  const endTime = process.hrtime.bigint();
  const duration = Number(endTime - startTime) / 1e9;
  analyzeSpinner.succeed(`Analyzed in ${chalk.bold(duration.toFixed(2))}s`);

  const scores = [...merged.values()];

  console.log();
  if (scores.length === 0) {
    console.log(
      boxen(`${chalk.yellow('⚠')} No libraries detected`, {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        borderColor: 'yellow',
        borderStyle: 'round',
      })
    );
  } else {
    const resultLines = scores
      .map((score) => {
        const type3Version = score.type3Versions.join(', ');
        const type2Version = score.type2Versions.join(', ');
        const topVersion = score.topVersions.join(', ');
        const version = type3Version || type2Version || topVersion;
        const libName = score.libName === 'react-dom' ? 'react' : score.libName;
        return `  ${chalk.cyan('●')} ${chalk.bold(libName)} ${chalk.dim('@')} ${chalk.yellow(version)}`;
      })
      .join('\n');

    console.log(
      boxen(
        `${chalk.bold.green('📚 Detected Libraries')}\n\n${resultLines}\n\n${chalk.dim(`Total: ${scores.length} library(ies)`)}`,
        {
          padding: 1,
          borderColor: 'green',
          borderStyle: 'round',
        }
      )
    );
  }

  if (isWeb) {
    if (save) {
      console.log(
        `${chalk.green('✔')} Downloaded scripts saved to ${chalk.underline(mainFolder)}`
      );
    } else {
      fs.rmSync(mainFolder, { recursive: true, force: true });
    }
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
        console.log(
          boxen(
            `${chalk.red('✖')} Missing target path or URL\n\n${chalk.dim('Usage: debun detect <path> or debun detect -w <url>')}`,
            {
              padding: { top: 0, bottom: 0, left: 1, right: 1 },
              borderColor: 'red',
              borderStyle: 'round',
            }
          )
        );
        process.exit(1);
      }
      await detectLibrary(target, flags.web, flags.save);
      break;
    }
    case 'add': {
      const packageNames = args.slice(1);
      if (packageNames.length === 0) {
        console.log(
          boxen(
            `${chalk.red('✖')} Missing package name(s)\n\n${chalk.dim('Usage: debun add <package-name1> <package-name2> ...')}`,
            {
              padding: { top: 0, bottom: 0, left: 1, right: 1 },
              borderColor: 'red',
              borderStyle: 'round',
            }
          )
        );
        process.exit(1);
      }
      await addPackages(packageNames);
      break;
    }
    case 'reset': {
      const spinner = ora({
        text: 'Resetting database...',
        spinner: 'dots',
      }).start();

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

      spinner.succeed('Database has been reset to the original state');
      break;
    }
    case 'list': {
      const spinner = ora({
        text: 'Loading library list...',
        spinner: 'dots',
      }).start();
      const dbDir = path.join(__dirname, 'data');
      const libNames = getLibNamesFromDb(dbDir);
      const outputPath = path.join(dbDir, 'library-list.txt');
      fs.writeFileSync(outputPath, libNames.join('\n') + '\n');

      spinner.succeed('Library list generated');

      console.log(
        boxen(
          `${chalk.green('✔')} Saved to ${chalk.underline(outputPath)}\n\n📦 ${chalk.bold(libNames.length)} libraries in database`,
          {
            padding: { top: 0, bottom: 0, left: 1, right: 1 },
            borderColor: 'green',
            borderStyle: 'round',
          }
        )
      );
      break;
    }
    default: {
      console.log(
        boxen(`${chalk.red('✖')} Unknown command: ${chalk.bold(command)}`, {
          padding: { top: 0, bottom: 0, left: 1, right: 1 },
          borderColor: 'red',
          borderStyle: 'round',
        })
      );
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
