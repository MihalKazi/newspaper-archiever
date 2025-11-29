const NewspaperScraper = require('./src/scraper');
const chalk = require('chalk');

async function testScraper() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(chalk.red('Please provide a URL to test'));
    console.log(chalk.yellow('Usage: node test-scraper.js <URL>'));
    process.exit(1);
  }

  const url = args[0];
  const scraper = new NewspaperScraper();

  console.log(chalk.blue.bold('\n🔍 Testing Newspaper Scraper\n'));
  console.log(chalk.gray(`URL: ${url}\n`));

  try {
    await scraper.initialize();
    console.log(chalk.green('✓ Browser initialized\n'));

    // Test 1: Discover articles
    console.log(chalk.blue('Test 1: Discovering articles...'));
    const articleLinks = await scraper.scrapeWebsite(url, (progress) => {
      console.log(chalk.gray(`  ${progress.message}`));
    });

    console.log(chalk.green(`✓ Found ${articleLinks.length} articles\n`));
    
    if (articleLinks.length > 0) {
      console.log(chalk.blue('First 10 article URLs:'));
      articleLinks.slice(0, 10).forEach((link, i) => {
        console.log(chalk.gray(`  ${i + 1}. ${link}`));
      });
      console.log('');

      // Test 2: Scrape first article
      const testUrl = articleLinks[0];
      console.log(chalk.blue(`Test 2: Scraping first article...`));
      console.log(chalk.gray(`  URL: ${testUrl}\n`));

      const article = await scraper.scrapeArticle(testUrl, (progress) => {
        console.log(chalk.gray(`  ${progress.status}: ${progress.url || ''}`));
      });

      if (article) {
        console.log(chalk.green('✓ Article scraped successfully\n'));
        
        // Display extracted data
        console.log(chalk.blue('Extracted Data:'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.yellow('Title:'), article.title);
        console.log(chalk.yellow('Author:'), article.author);
        console.log(chalk.yellow('Date:'), article.publishDate);
        console.log(chalk.yellow('Content Length:'), article.content.length, 'characters');
        console.log(chalk.yellow('Word Count:'), article.content.split(/\s+/).length);
        console.log(chalk.yellow('Tags:'), article.tags.length > 0 ? article.tags.join(', ') : 'None');
        console.log(chalk.yellow('Images:'), article.images.length);
        console.log(chalk.yellow('Videos:'), article.videos.length);
        console.log(chalk.gray('─'.repeat(60)));
        
        console.log(chalk.blue('\nFirst 500 characters of content:'));
        console.log(chalk.gray(article.content.substring(0, 500) + '...\n'));

        if (article.images.length > 0) {
          console.log(chalk.blue('First 5 images:'));
          article.images.slice(0, 5).forEach((img, i) => {
            console.log(chalk.gray(`  ${i + 1}. ${img.url}`));
            if (img.alt) console.log(chalk.gray(`     Alt: ${img.alt}`));
          });
          console.log('');
        }

        // Validation
        console.log(chalk.blue('Validation:'));
        const issues = [];
        if (article.title === 'Untitled Article') issues.push('⚠️  Title not extracted properly');
        if (article.author === 'Unknown') issues.push('⚠️  Author not found');
        if (article.content.length < 200) issues.push('⚠️  Content seems too short');
        if (article.tags.length === 0) issues.push('ℹ️  No tags found (may be normal)');
        if (article.images.length === 0) issues.push('ℹ️  No images found (may be normal)');

        if (issues.length > 0) {
          console.log(chalk.yellow('Issues detected:'));
          issues.forEach(issue => console.log(chalk.yellow(`  ${issue}`)));
        } else {
          console.log(chalk.green('✓ All checks passed!'));
        }

      } else {
        console.log(chalk.red('✗ Failed to extract article data'));
      }
    } else {
      console.log(chalk.yellow('\n⚠️  No articles found!'));
      console.log(chalk.gray('\nPossible reasons:'));
      console.log(chalk.gray('  1. The URL might not be a news section'));
      console.log(chalk.gray('  2. The website structure is not recognized'));
      console.log(chalk.gray('  3. The website requires authentication'));
      console.log(chalk.gray('  4. The website blocks automated access'));
      console.log(chalk.gray('\nTry:'));
      console.log(chalk.gray('  - Using a different URL from the same site'));
      console.log(chalk.gray('  - Using the homepage or main news section'));
      console.log(chalk.gray('  - Checking if the site loads properly in your browser'));
    }

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
    console.error(chalk.gray(error.stack));
  } finally {
    await scraper.close();
    console.log(chalk.blue('\n✓ Test complete\n'));
  }
}

testScraper();