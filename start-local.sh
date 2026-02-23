#!/bin/bash
set -e

mkdir -p data
mkdir -p data/slp

npm run build
npm run build:server
npm run start:server
