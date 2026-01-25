# GTFS Frequency

A tool for analyzing transit service quality using GTFS schedule data. Provides standardized, evidence-based route classification for comparative transit research.

GTFS Frequency is a single-file web application that allows transit researchers and advocates to objectively measure "frequent service" across different agencies.

## 🚀 Key Features

### 📊 Service Analysis
- **Standardized Tiers**: Classifies routes into 6 categories from "Freq+" (≤10 min) to "Sparse" (>60 min).
- **Maximum Scheduled Gap**: Focuses on the single biggest gap in service, ensuring "frequent" actually means frequent.
- **Grace Period Tolerance**: Allows for real-world scheduling quirks (+5 min tolerance, max 2 violations).

### ⚡ Efficiency Tools
- **Client-Side Processing**: No servers, no data uploads. Process large GTFS ZIPs entirely in your browser.
- **Auto-Validation**: Encourages spot-checking against agency PDF schedules for 100% accuracy.
- **Instant Export**: Download structured JSON data for use in GIS or longitudinal research.

### 🧠 Research-Ready
- **Atlas Integration**: Feeds data into the [Transit Networks Atlas](https://github.com/ryanhanna/FrequentTransitNetworks).
- **Methodology Focused**: Built on a consistent measurement framework to eliminate agency-specific definitions.
- **Citation Support**: Standardized formatting for use in academic or advocacy research.

### 🌒 Simple Design
- **Single-File Architecture**: Entirely self-contained (HTML/JS/CSS).
- **Static Deployment**: Hosted 100% via GitHub Pages with zero backend dependencies.

---

## 🛠️ Getting Started

1. **Upload GTFS ZIP** - Download from your transit agency's open data portal.
2. **Set analysis window** - Default is 7am-10pm (typical service hours).
3. **Click ANALYZE** - Tool processes all routes instantly.
4. **Validate & Export** - Spot-check results and save the JSON metadata.

👉 **[Try the Live Demo](https://ryanphanna.github.io/GTFS-Screener/)**

---

## 📄 Documentation & Links

- **[SECURITY.md](./SECURITY.md)** - Privacy and local-only data model.
- **[Methodology](https://www.notion.so/lowandhigh/Transit-Networks-ea714af9cebb4430bad9d642dc8afc96)** - Deep dive into classification rules.
- **[Atlas Repo](https://github.com/ryanhanna/FrequentTransitNetworks)** - Longitudinal database project.

---

## ⚖️ License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Created by Ryan Hanna** | [ryanisnota.pro](https://ryanisnota.pro) | [Project Roadmap](https://www.notion.so/lowandhigh/Transit-Networks-ea714af9cebb4430bad9d642dc8afc96)
