const NewspaperScraper = require('./scraper');
const MediaDownloader = require('./downloader');
const StorageManager = require('./storage');
const config = require('../config.json');
const ora = require('ora');
const chalk = require('chalk');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(chalk.red('Error: Please provide a URL'));
    console.log(chalk.yellow('Usage: npm run scrape -- <URL>'));
    console.log(chalk.yellow('Example: npm run scrape -- https://www.bbc.com/news'));
    process.exit(1);
  }

  const url = args[0];
  
  console.log(chalk.blue.bold('\n📰 Newspaper Archiver\n'));
  console.log(chalk.gray(`Target: ${url}\n`));

  const scraper = new NewspaperScraper();
  let storage = null;
  let downloader = null;

  let spinner = ora('Initializing browser...').start();

  try {
    await scraper.initialize();
    storage = new StorageManager(url);
    await storage.initialize();
    downloader = new MediaDownloader(storage.getArchiveDir());

    spinner.succeed('Browser initialized');

    // Discover articles
    spinner = ora('Discovering articles...').start();
    
    const articleLinks = await scraper.scrapeWebsite(url, (progress) => {
      if (progress.count) {
        spinner.text = `Found ${progress.count} articles`;
      }
    });

    if (articleLinks.length === 0) {
      spinner.fail('No articles found');
      console.log(chalk.yellow('\nTips:'));
      console.log(chalk.gray('- Make sure the URL points to a news section or homepage'));
      console.log(chalk.gray('- Try a different page on the website'));
      console.log(chalk.gray('- Check if the website requires authentication'));
      await scraper.close();
      process.exit(1);
    }

    spinner.succeed(`Found ${articleLinks.length} articles`);

    // Scrape each article
    console.log(chalk.blue(`\nScraping ${articleLinks.length} articles...\n`));

    let scraped = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < articleLinks.length; i++) {
      const articleUrl = articleLinks[i];
      const progress = `[${i + 1}/${articleLinks.length}]`;
      
      spinner = ora(`${progress} ${articleUrl.substring(0, 60)}...`).start();

      try {
        const article = await scraper.scrapeArticle(articleUrl, () => {});

        if (!article) {
          spinner.fail(chalk.red(`${progress} Failed to extract`));
          failed++;
          continue;
        }

        // Check for duplicates
        if (storage.isDuplicate(article)) {
          spinner.warn(chalk.yellow(`${progress} Duplicate - skipped`));
          skipped++;
          continue;
        }

        // Download media
        const mediaFiles = config.downloadMedia 
          ? await downloader.downloadMedia(article, storage.generateArticleId(article))
          : { images: [], videos: [], pdfs: [] };

        // Save article
        await storage.saveArticle(article, mediaFiles);

        scraped++;
        const title = article.title.substring(0, 50);
        spinner.succeed(chalk.green(`${progress} ${title}`));

      } catch (error) {
        spinner.fail(chalk.red(`${progress} Error: ${error.message}`));
        failed++;
      }
    }

    // Save all formats
    spinner = ora('Saving archive files...').start();
    await storage.saveAllFormats();
    spinner.succeed('Archive saved');

    // Summary
    console.log(chalk.blue.bold('\n📊 Summary\n'));
    console.log(chalk.green(`✓ Scraped: ${scraped}`));
    if (skipped > 0) console.log(chalk.yellow(`⊘ Skipped (duplicates): ${skipped}`));
    if (failed > 0) console.log(chalk.red(`✗ Failed: ${failed}`));
    console.log(chalk.gray(`\n📁 Archive location: ${storage.getArchiveDir()}`));

  } catch (error) {
    if (spinner) spinner.fail('Fatal error');
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    process.exit(1);
  } finally {
    await scraper.close();
  }
}

main();