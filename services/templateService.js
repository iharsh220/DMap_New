const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');

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