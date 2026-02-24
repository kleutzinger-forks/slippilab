#!/usr/bin/env sh
set -e

# Build frontend and server (node_modules already installed by buildpack)
npm run build
npm run build:server

# Ensure persistent data directories exist
mkdir -p data/slp
