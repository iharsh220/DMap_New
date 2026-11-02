const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');

// Register Handlebars helpers
handlebars.registerHelper('eq', function(a, b, options) {
  // Handle both block helper {{#if (eq a b)}} and inline usage
  if (options && typeof options.fn === 'function') {
    // Block helper usage
    if (a === b) {
      return options.fn(this);
    }
    return options.inverse(this);
  }
  // Inline usage - just return boolean
  return a === b;
});

// Email images are sent as CID attachments (see mailService) instead of base64 data URIs:
// Outlook desktop and Gmail do not display data: URIs, and inlining made every email ~1 MB.
// Templates keep using {{logo_base64}} / {{banner_base64}}; they now resolve to cid: URLs.
const EMAIL_IMAGES = {
  logo: {
    cid: 'dmap-logo@alembicdigilabs',
    filename: 'alembic-logo.jpg',
    path: path.join(__dirname, '..', 'public/images/email/alembic-logo.jpg')
  },
  banner: {
    cid: 'dmap-banner@alembicdigilabs',
    filename: 'mail-banner.jpg',
    path: path.join(__dirname, '..', 'public/images/email/mail-banner.jpg')
  }
};

// Attachments for the email images actually referenced in the rendered HTML
const getEmailImageAttachments = (html) => {
  if (!html) return [];
  return Object.values(EMAIL_IMAGES)
    .filter(image => html.includes(`cid:${image.cid}`))
    .map(image => ({ filename: image.filename, path: image.path, cid: image.cid, contentDisposition: 'inline' }));
};

// Compiled templates are cached: each file is read and compiled once, not on every email
const compiledTemplates = new Map();

const getCompiledTemplate = (templateName) => {
  if (!compiledTemplates.has(templateName)) {
    const templatePath = path.join(__dirname, '../email-templates', `${templateName}.html`);
    compiledTemplates.set(templateName, handlebars.compile(fs.readFileSync(templatePath, 'utf8')));
  }
  return compiledTemplates.get(templateName);
};

// Function to render email template
const renderTemplate = (templateName, data) => {
  const template = getCompiledTemplate(templateName);

  // Get frontend URL from environment variable with fallback
  const frontendUrl = process.env.FRONTEND_URL || 'https://dmap.alembicdigilabs.com';

  // Inject image URLs and frontend URL into the template data
  const templateData = {
    ...data,
    logo_base64: `cid:${EMAIL_IMAGES.logo.cid}`,
    banner_base64: `cid:${EMAIL_IMAGES.banner.cid}`,
    frontend_url: data.frontend_url || frontendUrl
  };

  // Render the template with data
  return template(templateData);
};

module.exports = { renderTemplate, getEmailImageAttachments };
