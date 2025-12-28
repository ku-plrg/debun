# DEBUN: Detecting Bundled JavaScript Libraries on Web using Property-Order Graphs


## Overview

DEBUN is a CLI tool that detects **third-party JavaScript libraries embedded inside bundled web applications**.  
Even after transformations performed by bundlers such as Webpack, Rollup, or Parcel, DEBUN leverages **Property-Order Graphs (POGs)** to capture execution characteristics that remain stable, enabling accurate identification of libraries inside minified and concatenated code.

## Installation

Using npm:
```bash
$ npm i -g debun-cli
```

## Usage

**Detect libraries from a web page**
```bash
$ debun "<url>"
```

Example:
```bash
$ debun "https://google.com"
```