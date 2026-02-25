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

// Cache for base64 images to avoid reading files multiple times
const base64Cache = {};

// Function to convert image file to base64 data URI
const getImageAsBase64 = (imagePath, mimeType) => {
  try {
    const fullPath = path.join(__dirname, '..', imagePath);
    if (fs.existsSync(fullPath)) {
      const imageBuffer = fs.readFileSync(fullPath);
      const base64 = imageBuffer.toString('base64');
      return `data:${mimeType};base64,${base64}`;
    }
    console.warn(`Image not found: ${fullPath}`);
    return null;
  } catch (error) {
    console.error(`Error reading image ${imagePath}:`, error);
    return null;
  }
};

// Function to get logo as base64 (cached)
const getLogoBase64 = () => {
  if (!base64Cache.logo) {
    base64Cache.logo = getImageAsBase64('public/images/icons/Alembic-Logo.jpg', 'image/jpeg');
  }
  return base64Cache.logo;
};

// Function to get banner as base64 (cached)
const getBannerBase64 = () => {
  if (!base64Cache.banner) {
    base64Cache.banner = getImageAsBase64('public/images/icons/Mail Banner.jpg', 'image/jpeg');
  }
  return base64Cache.banner;
};

// Function to render email template
const renderTemplate = (templateName, data) => {
  const templatePath = path.join(__dirname, '../email-templates', `${templateName}.html`);
  const templateSource = fs.readFileSync(templatePath, 'utf8');

  // Compile the template with Handlebars
  const template = handlebars.compile(templateSource);

  // Inject base64 images into the template data
  const templateData = {
    ...data,
    logo_base64: getLogoBase64(),
    banner_base64: getBannerBase64()
  };

  // Render the template with data
  return template(templateData);
};

module.exports = { renderTemplate };
