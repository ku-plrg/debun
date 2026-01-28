import fs, { readFileSync } from 'fs';
import { join } from 'path';
import semverSort from 'semver/functions/sort';
import semverValid from 'semver/functions/valid';
import fg from 'fast-glob';

import fingerprintCollector from './fingerprint-collector/index';
import { POGHash, LibData, HashData } from './types/types';

const rootDir = process.cwd();
const hashFilename = join(rootDir, `../data/all-hash.json`);
const libFilename = join(rootDir, `../data/all-libs.json`);
const outputDir = join(rootDir, '../data');
fs.mkdirSync(outputDir, { recursive: true });
const npmDataDirPath = join(rootDir, '../../../misc/crawlers/npm/output');

const parseVersionString = (version: string) => {
  const [major, minor, patch = '0'] = version.split('.');
  const [patchVersion, patchSuffix = '0'] = patch.split('-');
  return [
    parseInt(major),
    parseInt(minor),
    parseInt(patchVersion),
    patchSuffix,
  ];
};

function isJS(files: string[]): string[] {
  return files.filter(
    (file) =>
      file.endsWith('js') || file.endsWith('mjs') || file.endsWith('cjs')
  );
}

(async () => {
  const start = Date.now();
  let allLibs: LibData = {};
  let allHashes: HashData = {};
  try {
    let libId = 0;
    const libNames = fs.readdirSync(npmDataDirPath);
    const totalLibs = libNames.length;

    for (const libName of libNames) {
      let hashes: POGHash[] = [];
      console.log(`[${libId + 1}/${totalLibs}] processing ${libName}`);
      const libStart = Date.now();

      const versions = fs.readdirSync(join(npmDataDirPath, libName));
      const validVersions = versions.filter(
        (version) =>
          semverValid(version) && parseVersionString(version)[3] === '0'
      );
      const sortedVersions = semverSort(validVersions);

      let versionIdx = 0;
      for (const version of sortedVersions) {
        hashes = [];
        console.log(
          `[${versionIdx + 1}/${sortedVersions.length}] ${version} processing...`
        );
        const versionPath = join(npmDataDirPath, libName, version);
        const preferredDirs = ['src', 'lib', 'source', 'dist', 'closure', 'js'];
        const targetDirs = preferredDirs.filter((dir) => {
          const dirPath = join(versionPath, dir);
          return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
        });
        const patterns =
          targetDirs.length > 0
            ? targetDirs.map((dir) => `${dir}/**/*`)
            : ['**/*'];
        const files = await fg(patterns, { cwd: versionPath });
        const jsFiles = isJS(files);

        for (const file of jsFiles) {
          try {
            const code = readFileSync(join(versionPath, file), 'utf-8');

            try {
              const newHashes = fingerprintCollector(code);
              hashes.push(...newHashes);
            } catch (hashError) {
              const errorMsg = (hashError as Error).message;
              console.log('[Hash error]', errorMsg, libName, version, file);
            }
          } catch (readError) {
            console.log(
              '[Read error]',
              (readError as Error).message,
              libName,
              version,
              file
            );
          }
        }
        const uniq = new Map<string, POGHash>();
        for (const h of hashes) {
          if (h.nodes > 6) uniq.set(h.hash, h);
        }
        const uniqueHashes = [...uniq.values()];
        allLibs[libId] ??= { name: libName, versions: [], hashCnt: [] };
        allLibs[libId].versions.push(version);
        allLibs[libId].hashCnt.push(uniqueHashes.length);

        for (const { hash, nodes } of uniqueHashes) {
          allHashes[nodes] ??= {};
          allHashes[nodes][hash] ??= {};

          if (allHashes[nodes][hash][libId]) {
            const prevHash = allHashes[nodes][hash][libId];
            const lastRange = prevHash[prevHash.length - 1];

            if (lastRange[1] === versionIdx - 1) {
              lastRange[1] = versionIdx;
            } else {
              prevHash.push([versionIdx, versionIdx]);
            }
          } else {
            allHashes[nodes][hash][libId] = [[versionIdx, versionIdx]];
          }
        }
        versionIdx++;
      }

      console.log(
        `  ↳ completed in ${Date.now() - libStart}ms (${sortedVersions.length} versions, ${versionIdx} processed)`
      );
      libId++;
    }
  } catch (e) {
    console.error('error', (e as Error).message);
    console.log('write', hashFilename, 'before I die..');
    console.log('write', libFilename, 'before I die..');
    fs.writeFileSync(
      hashFilename.replace('.json', '-error.json'),
      JSON.stringify(allHashes)
    );
    fs.writeFileSync(
      libFilename.replace('.json', '-error.json'),
      JSON.stringify(allLibs)
    );
  }

  console.log('finish', Date.now() - start, 'ms');
  fs.writeFileSync(hashFilename, JSON.stringify(allHashes));
  fs.writeFileSync(libFilename, JSON.stringify(allLibs));
})();
