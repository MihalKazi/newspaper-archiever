# 📰 Newspaper Archiver

A powerful, locally-running tool for archiving newspaper articles from any website. Archive complete articles with all media, metadata, and multiple export formats.

## ✨ Features

- **Universal Scraping**: Works with any newspaper website
- **Complete Extraction**: Gets title, author, date, content, tags, and media
- **Media Downloads**: Automatically downloads images, videos, and PDFs
- **Multiple Formats**: Saves as JSON, CSV, HTML, and Markdown
- **Duplicate Detection**: Skips articles you've already archived
- **Progress Tracking**: Real-time updates on scraping progress
- **Beautiful Web UI**: Easy-to-use interface in your browser
- **100% Local**: All data stays on your machine

## 🚀 Quick Start

### Prerequisites

- Node.js 16 or higher
- npm (comes with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/newspaper-archiver.git
cd newspaper-archiver

# Install dependencies
npm install

# Start the server
npm start
```

The app will open at `http://localhost:3000`

## 📖 Usage

### Web Interface

1. Open `http://localhost:3000` in your browser
2. Enter a newspaper website URL
3. Click "Start Archiving"
4. Watch the progress in real-time
5. Find your archived articles in the `archives/` folder

### Command Line

```bash
# Basic usage
npm run scrape -- <URL>

# Examples
npm run scrape -- https://www.bbc.com/news
npm run scrape -- https://www.theguardian.com
```

## 📁 Archive Structure

```
archives/
└── newspaper-domain.com/
    ├── articles.json          # Complete archive in JSON
    ├── articles.csv           # Spreadsheet format
    ├── summary.json           # Statistics and metadata
    ├── README.md              # Human-readable summary
    ├── index.json             # Quick lookup index
    ├── articles/
    │   ├── article_abc123.json
    │   ├── article_abc123.html
    │   └── article_abc123.md
    └── media/
        ├── images/
        ├── videos/
        └── pdfs/
```

## ⚙️ Configuration

Edit `config.json` to customize behavior:

```json
{
  "archiveDir": "./archives",
  "maxConcurrentPages": 3,
  "pageTimeout": 30000,
  "downloadMedia": true,
  "saveHTML": true,
  "saveMarkdown": true,
  "takeScreenshots": false
}
```

## 🔧 Advanced Features

### Duplicate Detection

The archiver automatically skips articles you've already saved by checking:
- Article URLs
- Article titles (normalized)

### Error Handling

- Automatic retry on failures (configurable)
- Graceful handling of inaccessible articles
- Detailed error logging

### Media Management

- Deduplicates identical media files
- Preserves original filenames when possible
- Organizes by media type (images/videos/pdfs)

## 🛠️ Troubleshooting

### "Failed to scrape" errors

Some websites have anti-scraping measures. Try:
- Reducing `maxConcurrentPages` in config.json
- Increasing `pageTimeout`
- Checking if the site requires login

### Media not downloading

- Check your internet connection
- Some sites block direct media downloads
- Verify the media URLs are accessible

### Memory issues with large sites

- Reduce `maxConcurrentPages`
- Archive in smaller batches
- Disable screenshots if enabled

## 📊 Export Formats

### JSON
Complete structured data with all metadata and content.

### CSV
Spreadsheet-friendly format for easy browsing and analysis.

### Markdown
Human-readable format perfect for note-taking apps.

### HTML
Original page HTML for maximum fidelity.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this for any purpose.

## ⚠️ Legal Disclaimer

This tool is for personal archiving and research purposes. Always respect:
- Website terms of service
- Copyright laws
- robots.txt directives
- Rate limiting and server resources

The authors are not responsible for misuse of this tool.

## 🌟 Tips

1. **Start Small**: Test with a single article page first
2. **Respect Servers**: Don't hammer websites with requests
3. **Check Results**: Verify the first few articles are extracted correctly
4. **Backup Archives**: The archive folder can grow large
5. **Clean URLs**: Use the main section page (e.g., /news) not individual articles

## 📞 Support

Having issues? Please:
1. Check the troubleshooting section above
2. Look at existing GitHub issues
3. Open a new issue with details about your problem

## 🎯 Roadmap

- [ ] Scheduling for automatic archiving
- [ ] Full-text search across archives
- [ ] Archive comparison and diff tools
- [ ] Export to PDF
- [ ] Browser extension
- [ ] Docker support

---

Made with ❤️ for archiving and preserving journalism