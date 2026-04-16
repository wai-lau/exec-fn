# exec-fn

Personal automation system designed to support executive function (ADHD scaffolding).

## Architecture

- **Droplet**: DigitalOcean NYC1, reserved IP 168.144.13.51, domain wai-lau.net
- **nginx**: bare-metal, handles SSL termination, proxies to Docker on port 8080
- **FastAPI**: serves static files and will handle pipeline API endpoints
- **Docker**: single container locally and on Droplet, same compose file

## Stack

- Python / FastAPI
- Docker / docker-compose
- nginx (bare-metal on Droplet only)

## Project structure

exec-fn/
  web/         # static frontend
  api/         # FastAPI backend
  CLAUDE.md

## Local dev

docker compose up --build
Hit localhost:8080

## Deploy

SSH into root@wai-lau.net
cd /exec-fn
git pull
docker compose up -d --build

## Roadmap

### Phase 1 - reMarkable pipeline
- Poll reMarkable cloud via rmapi for new documents in a specific folder
- When detected, pull PDF, send to Claude API for task extraction and prioritization
- Generate a task breakdown PDF, push back to reMarkable

### Phase 2 - Voice conversation
- When prioritization is complex, user opens voice conversation with Claude
- Summary gets committed to server when user is happy
- Server generates task breakdown and pushes to reMarkable

## Notes

- User is on WSL, paths like /mnt/c/Users/wailu/
- Anthropic API key will be in .env
