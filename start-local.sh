#!/bin/bash
set -e

mkdir -p data
mkdir -p data/slp

# Initial server build so the server is ready before Vite starts
npm run build:server

# Watch server source and rebuild on changes
npm run build:server:watch &
ESBUILD_PID=$!

# Restart server automatically when the built file changes
npm run start:server:dev &
NODE_PID=$!

# Kill background processes on exit
trap "kill $ESBUILD_PID $NODE_PID 2>/dev/null; exit" INT TERM EXIT

# Vite dev server with HMR (foreground)
npm run dev
