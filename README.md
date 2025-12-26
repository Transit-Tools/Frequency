# GTFS Frequency Screener

A tool for analyzing transit service quality using GTFS schedule data. Provides standardized, evidence-based route classification for comparative transit research.

## What It Does

- Analyzes GTFS schedule data to determine actual service patterns
- Classifies routes into tiers based on maximum headways
- Validates results against agency schedules
- Exports structured data for longitudinal research

## Why This Matters

There's no standardized way to compare transit service across cities. Agencies define "frequent service" differently, making objective analysis impossible. This tool provides a consistent measurement framework for transit researchers and advocates.

## Live Demo

👉 **[Try it here](https://ryanphanna.github.io/GTFS-Screener/)**

## How to Use

1. **Upload GTFS ZIP file** - Download from your transit agency's open data portal
2. **Set analysis window** - Default is 7am-10pm (typical service hours)
3. **Click ANALYZE** - Tool processes all routes
4. **Validate results** - Spot-check against agency PDF schedules
5. **Export JSON** - Save results with full metadata

## Classification Methodology

Routes are classified by their **maximum scheduled gap** during the analysis window:

- **Freq+ (≤10 min)** - Very frequent
- **Freq (≤15 min)** - Frequent
- **Good (≤20 min)** - Good
- **Basic (≤30 min)** - Basic service
- **Infreq (≤60 min)** - Infrequent
- **Sparse (>60 min)** - Sparse service

**Grace period rules:**
- +5 minutes tolerance allowed
- Maximum 2 violations permitted
- Any gap beyond grace = tier failure

Example: A route averaging 10 minutes but with one 25-minute gap **fails** the ≤15 min tier.

Read more: [Methodology documentation](https://www.notion.so/lowandhigh/Transit-Networks-ea714af9cebb4430bad9d642dc8afc96)

## Export Format

```json
{
  "schema_version": "1.0",
  "check": {
    "id": "spokane-transit_2025-12-26",
    "created_at": "2025-12-26T20:00:00Z"
  },
  "agency": {...},
  "gtfs_feed": {
    "valid_from": "2025-08-03",
    "valid_to": "2026-01-17"
  },
  "routes": [...]
}
```

## Part of Frequent Transit Networks

This Screener feeds data into the **[Transit Networks Atlas](https://github.com/ryanhanna/FrequentTransitNetworks)** - a longitudinal database tracking transit service quality across North American cities.

## Technical Details

Single-file HTML application:
- JSZip for GTFS reading
- PapaParse for CSV parsing
- Vanilla JavaScript

## Contributing

- [Report bugs or issues](https://github.com/ryanhanna/GTFS-Screener/issues)
- Suggest methodology improvements
- Share your analysis results

## Research Use

Researchers using this tool can cite:

```
Hanna, R. (2025). GTFS Frequency Screener: Standardized Transit Service
Quality Analysis Tool. https://github.com/ryanhanna/GTFS-Screener
```

## License

MIT License

---

**Created by Ryan Hanna** | [ryanisnota.pro](https://ryanisnota.pro) | [Project Roadmap](https://www.notion.so/lowandhigh/Transit-Networks-ea714af9cebb4430bad9d642dc8afc96)
