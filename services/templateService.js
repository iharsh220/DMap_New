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

// Function to render email template
const renderTemplate = (templateName, data) => {
  const templatePath = path.join(__dirname, '../email-templates', `${templateName}.html`);
  const templateSource = fs.readFileSync(templatePath, 'utf8');

  // Compile the template with Handlebars
  const template = handlebars.compile(templateSource);

  // Render the template with data
  return template(data);
};

module.exports = { renderTemplate };