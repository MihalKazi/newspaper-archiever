const NewspaperScraper = require('./src/scraper');
const MediaDownloader = require('./src/downloader');
const StorageManager = require('./src/storage');
const config = require('./config.json');
const ora = require('ora');
const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');

async function scrapeArticle() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(chalk.red('Error: Please provide an article URL'));
    console.log(chalk.yellow('Usage: node scrape-article.js <ARTICLE_URL>'));
    console.log(chalk.yellow('Example: node scrape-article.js https://www.example.com/news/article-title'));
    process.exit(1);
  }

  const articleUrl = args[0];
  
  // Extract domain for storage
  const domain = new URL(articleUrl).hostname.replace(/^www\./, '');
  
  console.log(chalk.blue.bold('\n📰 Single Article Scraper\n'));
  console.log(chalk.gray(`Article: ${articleUrl}\n`));

  const scraper = new NewspaperScraper();
  let spinner = ora('Initializing browser...').start();

  try {
    await scraper.initialize();
    spinner.succeed('Browser initialized');

    // Scrape the article
    spinner = ora('Loading article...').start();
    
    const article = await scraper.scrapeArticle(articleUrl, (progress) => {
      spinner.text = progress.status || 'Processing...';
    });

    if (!article) {
      spinner.fail('Failed to extract article');
      console.log(chalk.red('\nArticle could not be extracted'));
      await scraper.close();
      process.exit(1);
    }

    spinner.succeed('Article extracted');

    // Display results
    console.log(chalk.blue('\n📄 Extracted Article:\n'));
    console.log(chalk.gray('═'.repeat(70)));
    console.log(chalk.yellow('Title:'), chalk.white(article.title));
    console.log(chalk.yellow('Author:'), chalk.white(article.author));
    console.log(chalk.yellow('Published:'), chalk.white(article.publishDate));
    console.log(chalk.yellow('Word Count:'), chalk.white(article.content.split(/\s+/).length));
    console.log(chalk.yellow('Characters:'), chalk.white(article.content.length));
    console.log(chalk.yellow('Tags:'), chalk.white(article.tags.length > 0 ? article.tags.join(', ') : 'None'));
    console.log(chalk.yellow('Images:'), chalk.white(article.images.length));
    console.log(chalk.yellow('Videos:'), chalk.white(article.videos.length));
    console.log(chalk.gray('═'.repeat(70)));

    // Show content preview
    console.log(chalk.blue('\n📝 Content Preview:\n'));
    const preview = article.content.substring(0, 500);
    console.log(chalk.gray(preview + (article.content.length > 500 ? '...' : '')));
    console.log('');

    // Ask if user wants to save
    console.log(chalk.blue('💾 Saving article...'));
    
    // Create storage
    const baseUrl = `https://${domain}`;
    const storage = new StorageManager(baseUrl);
    await storage.initialize();
    const downloader = new MediaDownloader(storage.getArchiveDir());

    spinner = ora('Downloading media...').start();
    
    // Download media
    const mediaFiles = config.downloadMedia 
      ? await downloader.downloadMedia(article, storage.generateArticleId(article))
      : { images: [], videos: [], pdfs: [] };

    spinner.succeed(`Downloaded ${mediaFiles.images.length} images, ${mediaFiles.videos.length} videos`);

    // Save article
    spinner = ora('Saving article...').start();
    const savedArticle = await storage.saveArticle(article, mediaFiles);
    await storage.saveAllFormats();
    spinner.succeed('Article saved');

    // Show summary
    console.log(chalk.green('\n✅ Success!\n'));
    console.log(chalk.blue('📁 Saved to:'), chalk.white(storage.getArchiveDir()));
    console.log(chalk.blue('📄 Article ID:'), chalk.white(savedArticle.id));
    
    console.log(chalk.blue('\n📦 Files created:'));
    console.log(chalk.gray(`  - ${savedArticle.id}.json`));
    if (config.saveHTML) console.log(chalk.gray(`  - ${savedArticle.id}.html`));
    if (config.saveMarkdown) console.log(chalk.gray(`  - ${savedArticle.id}.md`));
    console.log(chalk.gray(`  - articles.json (updated)`));
    console.log(chalk.gray(`  - articles.csv (updated)`));
    
    if (mediaFiles.images.length > 0) {
      console.log(chalk.gray(`  - ${mediaFiles.images.length} image(s) in media/images/`));
    }
    
    console.log('');

  } catch (error) {
    if (spinner) spinner.fail('Error occurred');
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    
    if (error.message.includes('Timeout')) {
      console.log(chalk.yellow('\n💡 Tips for timeout issues:'));
      console.log(chalk.gray('  1. The website might be slow - try increasing timeout in config.json'));
      console.log(chalk.gray('  2. Check if the URL loads in your browser'));
      console.log(chalk.gray('  3. The website might be blocking automated access'));
      console.log(chalk.gray('  4. Try again - sometimes websites are temporarily slow'));
    }
    
    process.exit(1);
  } finally {
    await scraper.close();
  }
}

scrapeArticle();