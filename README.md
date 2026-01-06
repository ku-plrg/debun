# debun-cli

> Detecting Bundled JavaScript Libraries on Web using Property-Order Graphs


## Overview

DEBUN is a CLI tool that detects **third-party JavaScript libraries embedded inside bundled web applications**. Even after transformations performed by bundlers such as Webpack, Rollup, or Parcel, DEBUN leverages **Property-Order Graphs (POGs)** to capture characteristics that remain stable, enabling accurate identification of libraries inside minified and concatenated code.

## Features

- 🔍 Detect libraries in minified and bundled JavaScript
- 🌐 Analyze both local files and live web pages

## Installation

Using npm:
```bash
$ npm i -g debun-cli
```

## Usage

**Detect libraries from Javascript directory or file**
```bash
$ debun "<path>"
```

Example:
```bash
$ debun src/test
```


**Detect libraries from a web page**
```bash
$ debun "<url>"
```

Example:
```bash
$ debun https://youtube.com
```

## Related

- [npm package](https://www.npmjs.com/package/debun-cli)
- [GitHub repository](https://github.com/yourusername/debun)

## Research Paper

This tool is based on the research paper:

**"DEBUN: Detecting Bundled JavaScript Libraries on Web using Property-Order Graphs"**

📄 **Paper**: https://plrg.korea.ac.kr/assets/data/publication/ase25-park-debun.pdf
👥 **Authors**: Seojin Kim, Sungmin Park, Jihyeok Park
📅 **Published**: ASE 2025 (IEEE/ACM International Conference on Automated Software Engineering)
