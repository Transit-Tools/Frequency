# Security Model

This document outlines the security architecture and privacy protections for the GTFS Frequency Screener.

## Architecture & Data Privacy

The GTFS Frequency Screener is a **client-side only application**. This architectural choice is the primary security feature.

### 1. No Data Uploads
- All GTFS data processing happens locally in your browser using JavaScript.
- Your data is never uploaded to a server, stored in a database, or transmitted over the network.
- The application can technically run entirely offline once the page is loaded.

### 2. Privacy by Design
- **No Analytics**: The tool does not use tracking cookies or third-party analytics (e.g., Google Analytics).
- **No Accounts**: There is no user authentication or account system. Your analysis results are yours to keep via the "Export" feature.

## Technical Security

### 1. External Dependencies
The application uses the following trusted libraries:
- **JSZip**: For reading and extracting GTFS ZIP files locally.
- **PapaParse**: For efficient CSV parsing within the browser.
- **Vanilla JS**: No heavy frameworks or complex backend integration.

### 2. Hosting
The application is hosted via **GitHub Pages**. Security is managed by GitHub's infrastructure, ensuring the delivery of the code via HTTPS.

## Reporting a Vulnerability

If you discover a security vulnerability or have concerns about the privacy model of this project, please open a GitHub Issue or contact the maintainer directly.
