# 📰 Newspaper Archiver

A powerful, locally-running tool for archiving newspaper articles from any website. Archive complete articles with all media, metadata, and multiple export formats organized by publication date.

[![Setup Guide](https://img.shields.io/badge/Setup-Guide-blue)](https://news-archiver-setup-guide.netlify.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen)](https://nodejs.org/)

## ✨ Features

- **🌐 Universal Scraping**: Works with any newspaper website (BBC, Guardian, Daily Star, Prothom Alo, etc.)
- **📄 Complete Extraction**: Gets title, author, date, content, tags, and media
- **📥 Media Downloads**: Automatically downloads images, videos, and PDFs
- **📊 Multiple Formats**: Saves as JSON, CSV, HTML, and Markdown
- **🗂️ Smart Organization**: Files organized by date (Year/Month/Day/Article-Title)
- **🔍 Duplicate Detection**: Skips articles you've already archived
- **⏱️ Progress Tracking**: Real-time updates on scraping progress
- **🎨 Beautiful Web UI**: Easy-to-use interface in your browser
- **🔒 100% Local**: All data stays on your machine, no cloud upload
- **🔄 Retry Logic**: Automatic retry on failures
- **📝 Detailed Logging**: Complete activity logs for debugging

## 🚀 Quick Start

### For Complete Beginners

**📖 [Click here for the complete setup guide](https://news-archiver-setup-guide.netlify.app/)**

The guide includes:
- ✅ Step-by-step installation (Windows, Mac, Linux)
- ✅ Screenshots for every step
- ✅ Video tutorials
- ✅ Troubleshooting tips

### Prerequisites

- **Node.js** 16 or higher ([Download here](https://nodejs.org))
- **Git** ([Download here](https://git-scm.com))
- **2GB RAM** minimum (4GB recommended)
- **1GB free disk space**

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/newspaper-archiver.git
cd newspaper-archiver

# 2. Install dependencies
npm install

# 3. Install Playwright browsers
npx playwright install

# 4. Start the server
npm start
```

The app will open at `http://localhost:3000`

## 📖 Usage

### Web Interface (Recommended)

1. Open `http://localhost:3000` in your browser
2. Choose archive mode:
   - **📄 Single Article** - Archive one specific article
   - **🌐 Full Website** - Archive multiple articles from a site
3. Paste the article URL
4. Click "Archive This Article"
5. Wait for completion (30 seconds - 5 minutes depending on article)
6. Find your archived articles in `archives/[website-name]/`

### Example URLs to Try

```
https://www.thedailystar.net/business/news/gold-eases-near-two-week-high-investors-book-profits-4044881
https://www.bbc.com/news/world-us-canada-12345678
https://www.theguardian.com/world/2024/jan/01/sample-article
https://www.prothomalo.com/bangladesh/district/[article-url]
```

## 📁 Archive Structure

Articles are organized by publication date with unique IDs:

```
archives/
└── thedailystar.net/
    ├── articles.json              # All articles in JSON
    ├── articles.csv               # Spreadsheet format
    ├── ARTICLES-BY-DATE.md        # Chronological listing
    ├── date-index.json            # Articles grouped by date
    ├── summary.json               # Statistics
    ├── README.md                  # Archive summary
    └── articles/
        └── 2024/
            └── 11-November/
                └── 29/
                    ├── gold-eases-near-high-a1b2c3d4/
                    │   ├── article.json    # Article data
                    │   ├── article.html    # Original HTML
                    │   ├── article.md      # Markdown format
                    │   ├── README.txt      # Article details
                    │   └── media/
                    │       ├── image_1.jpg
                    │       └── image_2.jpg
                    └── another-article-e5f6g7h8/
                        └── ...
```

**Note:** Each article folder has a unique ID (e.g., `-a1b2c3d4`) to prevent conflicts when multiple articles are published on the same date.

## ⚙️ Configuration

Edit `config.json` to customize behavior:

```json
{
  "archiveDir": "./archives",
  "maxConcurrentPages": 3,
  "pageTimeout": 30000,
  "waitForContent": 2000,
  "scrollDelay": 1000,
  "retryAttempts": 3,
  "retryDelay": 2000,
  "downloadMedia": true,
  "saveHTML": true,
  "saveMarkdown": true,
  "takeScreenshots": false,
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `archiveDir` | Where to save archives | `./archives` |
| `maxConcurrentPages` | Max parallel scraping | `3` |
| `pageTimeout` | Timeout per page (ms) | `30000` |
| `downloadMedia` | Download images/videos | `true` |
| `saveHTML` | Save original HTML | `true` |
| `saveMarkdown` | Save as Markdown | `true` |
| `takeScreenshots` | Take page screenshots | `false` |

## 🔧 Advanced Features

### Duplicate Detection

The archiver automatically skips articles you've already saved by checking:
- ✅ Article URLs (exact match)
- ✅ Article titles (normalized, case-insensitive)

### Automatic Retry

Failed articles are retried up to 3 times with:
- Exponential backoff
- Detailed error logging
- Graceful failure handling

### Media Management

- **Deduplication**: Identical media files downloaded only once
- **Organization**: Grouped by article and media type
- **Metadata**: Preserves alt text, titles, and descriptions

### Date-Based Organization

- **Year folders**: `2024/`
- **Month folders**: `11-November/`
- **Day folders**: `29/`
- **Article folders**: `article-title-uniqueid/`

### Export Formats

| Format | Use Case |
|--------|----------|
| **JSON** | Complete structured data, programmatic access |
| **CSV** | Spreadsheet analysis, easy browsing |
| **Markdown** | Note-taking apps, documentation |
| **HTML** | Original formatting, offline viewing |

## 🛠️ Troubleshooting

### Installation Issues

**"node is not recognized"**
```bash
# Restart your computer after installing Node.js
# Or reinstall from https://nodejs.org
```

**"npm install" fails**
```bash
# Run as administrator (Windows)
# Or use sudo on Mac/Linux
sudo npm install
```

**Playwright installation fails**
```bash
# Install only Chromium (faster)
npx playwright install chromium

# Or with sudo (Mac/Linux)
sudo npx playwright install
```

### Scraping Issues

**"Failed to extract article content"**
- Some websites have complex structures
- Try different articles from the same site
- Check if the site requires login
- See [Improved Content Detection](#improved-scraping)

**Timeout errors**
```bash
# Increase timeout in config.json
{
  "pageTimeout": 60000,  # 60 seconds
  "waitForContent": 5000 # 5 seconds
}
```

**"Port 3000 already in use"**
```bash
# Use a different port
set PORT=3001 && npm start   # Windows
PORT=3001 npm start          # Mac/Linux
```

### Memory Issues

**Out of memory with large sites**
```json
{
  "maxConcurrentPages": 1,  # Reduce to 1
  "takeScreenshots": false  # Disable screenshots
}
```

## 🎯 Improved Scraping

The scraper uses **4-level fallback strategy** to extract content:

1. **Primary**: Article-specific containers (`<article>`, `.article-content`)
2. **Secondary**: Semantic selectors (`[itemprop="articleBody"]`)
3. **Tertiary**: Intelligent paragraph detection
4. **Fallback**: Main content area extraction

### Supported Sites

Works with most news sites including:
- 🇧🇩 The Daily Star, Prothom Alo, Dhaka Tribune
- 🇬🇧 BBC, The Guardian, The Telegraph
- 🇺🇸 New York Times, Washington Post, CNN
- 🌍 Al Jazeera, Reuters, Associated Press

**Site not working?** Open an issue with the URL!

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

### Ways to Contribute

- 🐛 Report bugs
- 💡 Suggest features
- 📝 Improve documentation
- 🔧 Add support for specific news sites
- 🌍 Translate the interface

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## ⚠️ Legal Disclaimer

**This tool is for personal archiving and research purposes only.**

Please respect:
- ✅ Website terms of service
- ✅ Copyright and intellectual property laws
- ✅ `robots.txt` directives
- ✅ Rate limiting and server resources
- ✅ Privacy and data protection regulations

**The developer is not responsible for misuse of this tool.**

Users are solely responsible for ensuring their usage complies with applicable laws and website policies.

## 🌟 Usage Tips

1. **Start Small**: Test with a single article first
2. **Respect Servers**: Don't hammer websites with hundreds of requests
3. **Check Results**: Verify the first few articles extracted correctly
4. **Backup Archives**: The archive folder can grow large
5. **Clean URLs**: Use article URLs, not homepage/category pages
6. **Be Patient**: Complex articles take 1-2 minutes to fully archive
7. **Check Logs**: Monitor the activity log for issues

## 📊 Statistics

After archiving, find detailed statistics in:
- `archives/[website]/README.md` - Human-readable summary
- `archives/[website]/summary.json` - Machine-readable stats
- `archives/[website]/articles.csv` - Spreadsheet view

Includes:
- Total articles, words, images, videos
- Author list
- Tag cloud
- Date range
- Archive creation date

## 🎯 Roadmap

- [x] Basic article scraping
- [x] Media downloads
- [x] Multiple export formats
- [x] Date-based organization
- [x] Web interface
- [x] Progress tracking
- [x] Duplicate detection
- [ ] Scheduled automatic archiving
- [ ] Full-text search across archives
- [ ] Archive comparison tools
- [ ] PDF export with formatting
- [ ] Browser extension
- [ ] Docker container
- [ ] Mobile app

## 📞 Support & Contact

**Need help?**
1. 📖 Check the [Setup Guide](https://news-archiver-setup-guide.netlify.app/)
2. 🔍 Search [existing issues](https://github.com/yourusername/newspaper-archiver/issues)
3. 💬 Open a [new issue](https://github.com/yourusername/newspaper-archiver/issues/new)

**Developer:**
- 👨‍💻 **Kazi Rohanuzzaman Mehal**
- 📧 **Email:** rohankazi728@gmail.com
- 🔗 **Contact:** [linktr.ee/MihalKazi](https://linktr.ee/MihalKazi)

## 🙏 Acknowledgments

Built with:
- [Playwright](https://playwright.dev/) - Browser automation
- [Cheerio](https://cheerio.js.org/) - HTML parsing
- [Express](https://expressjs.com/) - Web server
- [date-fns](https://date-fns.org/) - Date formatting

## ⭐ Star History

If this tool helped you, please give it a ⭐ on GitHub!

---

**© 2025 Kazi Rohanuzzaman Mehal. All rights reserved.**

Made with ❤️ for preserving journalism and archiving important content.
