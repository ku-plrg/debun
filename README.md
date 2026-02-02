# Debun-cli

> Detecting Bundled JavaScript Libraries on Web using Property-Order Graphs


## Overview

**Debun-cli** is a CLI tool that detects **third-party JavaScript libraries embedded inside bundled web applications**. Even after transformations performed by bundlers such as Webpack, Rollup, or Parcel, **Debun** leverages **Property-Order Graphs (POGs)** to capture characteristics that remain stable, enabling accurate identification of libraries inside minified and concatenated code.

## Features

- 🔍 Detect libraries in minified and bundled JavaScript
- 🌐 Analyze both local files and live web pages

## Installation

Using npm:
```bash
$ npm i -g debun-cli
```

## Usage

### Commands

- **Detect libraries from local JavaScript files or a directory**
```bash
$ debun detect <path>
```

- **Detect libraries from a web page**
```bash
$ debun detect -w <url>
```

- **Add packages to the database**
```bash
$ debun add <package-name1> <package-name2> ...
```

- **Reset the database to the original state**
```bash
$ debun reset
```

- **List all libraries in the database**
```bash
$ debun list
```

### Options

- `-w, --web` Treat input as a web URL
- `--save` Save downloaded scripts to local files (only for `detect -w`)
- `-v, --version` Show version
- `-h, --help` Show help message

### Examples

```bash
$ debun detect ./src/js
$ debun detect -w https://example.com
$ debun add lodash
$ debun reset
```

## Related

- [npm package](https://www.npmjs.com/package/debun-cli)
- [GitHub repository](https://github.com/ku-plrg/debun)

## Research Paper

This tool is based on the research paper:

**"Debun: Detecting Bundled JavaScript Libraries on Web using Property-Order Graphs"**

- 📄 **Paper**: https://plrg.korea.ac.kr/assets/data/publication/ase25-park-debun.pdf
- 👥 **Authors**: Seojin Kim, Sungmin Park, Jihyeok Park
- 📅 **Published**: ASE 2025 (IEEE/ACM International Conference on Automated Software Engineering)
