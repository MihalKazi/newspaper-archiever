const express = require('express');
const path = require('path');
const NewspaperScraper = require('./scraper');
const MediaDownloader = require('./downloader');
const StorageManager = require('./storage');
const config = require('../config.json');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/archives', express.static(path.join(__dirname, '..', 'archives')));

// Active scraping jobs
const activeJobs = new Map();

app.post('/api/scrape', async (req, res) => {
  const { url, options = {} } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const jobId = Date.now().toString();
  
  res.json({ 
    jobId, 
    message: 'Scraping started',
    status: 'started' 
  });

  // Start scraping in background
  scrapeNewspaper(jobId, url, options);
});

app.get('/api/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

app.get('/api/jobs', (req, res) => {
  const jobs = Array.from(activeJobs.entries()).map(([id, job]) => ({
    jobId: id,
    ...job
  }));
  res.json(jobs);
});

async function scrapeNewspaper(jobId, url, options) {
  const job = {
    status: 'initializing',
    url,
    progress: 0,
    articlesFound: 0,
    articlesScraped: 0,
    articlesFailed: 0,
    currentArticle: null,
    startTime: Date.now(),
    logs: []
  };

  activeJobs.set(jobId, job);

  const scraper = new NewspaperScraper();
  let storage = null;
  let downloader = null;

  try {
    await scraper.initialize();
    storage = new StorageManager(url);
    await storage.initialize();
    downloader = new MediaDownloader(storage.getArchiveDir());

    job.status = 'discovering';
    job.logs.push({ time: new Date().toISOString(), message: 'Discovering articles...' });

    // Discover articles
    const articleLinks = await scraper.scrapeWebsite(url, (progress) => {
      job.logs.push({ time: new Date().toISOString(), message: progress.message });
      if (progress.count) {
        job.articlesFound = progress.count;
      }
    });

    job.articlesFound = articleLinks.length;
    job.status = 'scraping';
    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `Found ${articleLinks.length} articles. Starting extraction...` 
    });

    // Scrape each article
    for (let i = 0; i < articleLinks.length; i++) {
      const articleUrl = articleLinks[i];
      job.currentArticle = articleUrl;
      job.progress = Math.round(((i + 1) / articleLinks.length) * 100);

      try {
        job.logs.push({ 
          time: new Date().toISOString(), 
          message: `Scraping article ${i + 1}/${articleLinks.length}: ${articleUrl}` 
        });

        const article = await scraper.scrapeArticle(articleUrl, (progress) => {
          // Progress callback
        });

        if (!article) {
          job.articlesFailed++;
          continue;
        }

        // Check for duplicates
        if (storage.isDuplicate(article)) {
          job.logs.push({ 
            time: new Date().toISOString(), 
            message: `Skipped duplicate: ${article.title}` 
          });
          continue;
        }

        // Download media
        const mediaFiles = config.downloadMedia 
          ? await downloader.downloadMedia(article, storage.generateArticleId(article))
          : { images: [], videos: [], pdfs: [] };

        // Save screenshot if available
        if (article.screenshot) {
          mediaFiles.screenshot = await downloader.saveThumbnail(
            article.screenshot, 
            storage.generateArticleId(article)
          );
        }

        // Save article
        await storage.saveArticle(article, mediaFiles);

        job.articlesScraped++;
        job.logs.push({ 
          time: new Date().toISOString(), 
          message: `Saved: ${article.title}` 
        });

      } catch (error) {
        job.articlesFailed++;
        job.logs.push({ 
          time: new Date().toISOString(), 
          message: `Error scraping ${articleUrl}: ${error.message}`,
          level: 'error'
        });
      }
    }

    // Save all formats
    job.status = 'saving';
    job.logs.push({ time: new Date().toISOString(), message: 'Saving archive files...' });
    await storage.saveAllFormats();

    job.status = 'completed';
    job.progress = 100;
    job.endTime = Date.now();
    job.duration = Math.round((job.endTime - job.startTime) / 1000);
    job.archiveDir = storage.getArchiveDir();
    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `Archive completed! ${job.articlesScraped} articles saved in ${job.duration}s` 
    });

  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `Fatal error: ${error.message}`,
      level: 'error'
    });
  } finally {
    await scraper.close();
  }
}

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║       📰 Newspaper Archiver Server Running         ║
║                                                    ║
║       http://localhost:${PORT}                       ║
║                                                    ║
║   Open this URL in your browser to start          ║
║   archiving newspaper articles!                   ║
║                                                    ║
╚════════════════════════════════════════════════════╝
  `);
});
