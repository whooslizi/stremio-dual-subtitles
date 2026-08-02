# Stremio Dual Subtitles Addon

A lightweight Stremio addon that scrapes and merges two subtitle languages simultaneously for movies, series, and anime.

## Features

- **Multi-Source Scrapers**: Fetches from OpenSubtitles v3, Subdl, and Vietsub/Community providers in parallel.
- **Selectable Dual Tracks**: Pick your preferred source combination directly in Stremio's subtitle picker.
- **Anime Support**: Auto-resolves Kitsu, MyAnimeList, AniList, and TMDB IDs to IMDb entries via the ARM API.
- **No API Keys Required**: Works out of the box with zero user accounts or setup.

## Quick Start

### 1. Run Locally
```bash
npm install
npm start
```
Open `http://localhost:7000` in your browser to configure languages and install the addon into Stremio.

### 2. Run Tests
```bash
npm test
```

### 3. Deploy to Vercel
Deploy with 1-click on Vercel using `server.js` as the serverless entrypoint.

## Project Structure

```
├── scrapers/          # OpenSubtitles, Vietsub, and Subdl scrapers
├── lib/               # Sync engine, source selection, analytics, & persistence
├── addon.js           # Stremio manifest & subtitle handlers
├── server.js          # Express server & Vercel entrypoint
└── landingTemplate.js # Minimal web configuration interface
```

## Credits & Acknowledgments

Built using open APIs and community subtitle providers:
- [OpenSubtitles v3](https://opensubtitles-v3.strem.io)
- [Subdl](https://subdl.com) & SubSource
- [Anime Relations (ARM API)](https://arm.haglund.dev)
- [Stremio Addon SDK](https://github.com/Stremio/stremio-addon-sdk)

## License

[MIT](LICENSE)
