const config = require('../config');

/**
 * Render a template string by replacing {{variable}} placeholders with values.
 * Supports nested access like {{contact.first_name}} and fallback defaults {{var|default}}.
 */
function renderTemplate(template, variables = {}) {
  if (!template) return '';

  return template.replace(/\{\{(\w[\w.]*?)(?:\|([^}]*))?\}\}/g, (match, key, fallback) => {
    const value = getNestedValue(variables, key);
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
    return fallback !== undefined ? fallback : match;
  });
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, part) => {
    if (acc && typeof acc === 'object') return acc[part];
    return undefined;
  }, obj);
}

/**
 * Inject open tracking pixel into HTML content.
 */
function injectOpenTracker(html, trackingUrl) {
  if (!html || !trackingUrl) return html;
  const pixel = `<img src="${trackingUrl}" width="1" height="1" style="display:none;" alt="" />`;
  // Insert before closing body tag, or append
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  return html + pixel;
}

/**
 * Rewrite links in HTML to go through click tracker.
 * Preserves mailto: and unsubscribe links as-is.
 */
function rewriteLinks(html, baseTrackingUrl, campaignId, contactId) {
  if (!html || !baseTrackingUrl) return html;

  return html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (match, url) => {
      // Don't track unsubscribe links or anchor links
      if (url.includes('unsubscribe') || url.startsWith('#')) return match;

      const trackUrl = `${baseTrackingUrl}/t/click/${campaignId}/${contactId}?url=${encodeURIComponent(url)}`;
      return `href="${trackUrl}"`;
    }
  );
}

/**
 * Add UTM parameters to URLs in HTML content.
 */
function addUtmParams(html, { utm_source, utm_medium, utm_campaign }) {
  if (!html) return html;

  return html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
    if (url.includes('unsubscribe')) return match;
    try {
      const urlObj = new URL(url);
      if (utm_source) urlObj.searchParams.set('utm_source', utm_source);
      if (utm_medium) urlObj.searchParams.set('utm_medium', utm_medium);
      if (utm_campaign) urlObj.searchParams.set('utm_campaign', utm_campaign);
      return `href="${urlObj.toString()}"`;
    } catch {
      return match;
    }
  });
}

/**
 * Generate the unsubscribe link for a contact.
 */
function generateUnsubscribeLink(contactId, campaignId) {
  const base = config.tracking.domain || config.baseUrl;
  return `<a href="${base}/t/unsubscribe/${campaignId}/${contactId}" style="color:#9CA3AF;">Unsubscribe</a>`;
}

/**
 * Build the complete email HTML for a recipient.
 */
function buildEmail(campaign, contact, template) {
  const variables = {
    ...JSON.parse(contact.custom_fields || '{}'),
    first_name: contact.first_name,
    last_name: contact.last_name,
    email: contact.email,
    company: contact.company,
    title: contact.title,
    unsubscribe_link: generateUnsubscribeLink(contact.id, campaign.id),
  };

  let html = renderTemplate(template.html_content || campaign.html_content, variables);
  let text = renderTemplate(template.text_content || campaign.text_content, variables);
  let subject = renderTemplate(campaign.subject || template.subject, variables);

  // Add UTM parameters
  if (campaign.track_clicks) {
    html = addUtmParams(html, {
      utm_source: campaign.utm_source || 'email',
      utm_medium: campaign.utm_medium || 'email',
      utm_campaign: campaign.utm_campaign || campaign.name,
    });
  }

  // Rewrite links for click tracking
  if (campaign.track_clicks) {
    const base = config.tracking.domain || config.baseUrl;
    html = rewriteLinks(html, base, campaign.id, contact.id);
  }

  // Inject open tracking pixel
  if (campaign.track_opens) {
    const base = config.tracking.domain || config.baseUrl;
    const openUrl = `${base}/t/open/${campaign.id}/${contact.id}`;
    html = injectOpenTracker(html, openUrl);
  }

  return { subject, html, text };
}

module.exports = {
  renderTemplate,
  injectOpenTracker,
  rewriteLinks,
  addUtmParams,
  generateUnsubscribeLink,
  buildEmail,
};
