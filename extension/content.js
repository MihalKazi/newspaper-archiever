// Content script - runs on every page
// This can be used for future enhancements like:
// - Detecting article pages automatically
// - Showing archive status on the page
// - Quick archive button on article pages

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageInfo') {
    // Get page information
    const pageInfo = {
      url: window.location.href,
      title: document.title,
      // Could detect if page is an article
      isArticle: detectIfArticle()
    };
    sendResponse(pageInfo);
  }
});

// Simple article detection (can be improved)
function detectIfArticle() {
  // Check for common article indicators
  const hasArticleTag = !!document.querySelector('article');
  const hasTimeTag = !!document.querySelector('time');
  const hasAuthor = !!document.querySelector('[rel="author"], .author, .byline');
  
  // Check URL patterns
  const urlPatterns = [
    /\/article\//i,
    /\/news\//i,
    /\/story\//i,
    /\/\d{4}\/\d{2}\/\d{2}\//,  // Date in URL
    /\/post\//i
  ];
  
  const urlMatches = urlPatterns.some(pattern => pattern.test(window.location.pathname));
  
  // If it has article indicators or URL pattern, likely an article
  return (hasArticleTag || hasTimeTag || hasAuthor) && urlMatches;
}

// Optional: Add visual indicator when article is detected
if (detectIfArticle()) {
  console.log('📰 Article detected - right-click to archive');
}