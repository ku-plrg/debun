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
  let allLibs: LibData = {};
  let allHashes: HashData = {};
  try {
    let libId = 0;
    const libNames = fs.readdirSync(npmDataDirPath);
    for (const libName of libNames) {
      let hashes: POGHash[] = [];

      const versions = fs.readdirSync(join(npmDataDirPath, libName));
      const validVersions = versions.filter(
        (version) =>
          semverValid(version) && parseVersionString(version)[3] === '0'
      );
      const sortedVersions = semverSort(validVersions);

      let versionIdx = 0;
      for (const version of sortedVersions) {
        hashes = [];
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
            } catch (hashError) {}
          } catch (readError) {}
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
      libId++;
    }
  } catch (e) {}
  fs.writeFileSync(hashFilename, JSON.stringify(allHashes));
  fs.writeFileSync(libFilename, JSON.stringify(allLibs));
})();
