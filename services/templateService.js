const fs = require('fs');
const path = require('path');

// Function to render email template
const renderTemplate = (templateName, data) => {
  const templatePath = path.join(__dirname, '../email-templates', `${templateName}.html`);
  let template = fs.readFileSync(templatePath, 'utf8');

  // Replace placeholders
  Object.keys(data).forEach(key => {
    template = template.replace(new RegExp(`{{${key}}}`, 'g'), data[key]);
  });

  return template;
};

module.exports = { renderTemplate };