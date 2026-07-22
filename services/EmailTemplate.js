// Centralized Professional Email Template Builder
// All email templates should use this wrapper for consistent branding

class EmailTemplate {
  constructor() {
    this.logoUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/logo1.png`;
    this.brandName = 'Prove Ownership';
    this.tagline = 'Smart Device Registry & Recovery System';
    this.baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  }

  wrapContent(title, htmlContent, options = {}) {
    const {
      hideLogo = false,
      footerText = null,
      actionButton = null,
      showUnsubscribe = true,
    } = options;

    const logoHtml = hideLogo ? '' : `
      <tr>
        <td style="padding: 30px 0 20px; text-align: center;">
          <img src="${this.logoUrl}" alt="${this.brandName}" width="180" height="auto" style="display: block; margin: 0 auto; max-width: 180px; height: auto; border: 0; outline: none;" />
        </td>
      </tr>
    `;

    const buttonHtml = actionButton ? `
      <tr>
        <td style="padding: 20px 0; text-align: center;">
          <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
            <tr>
              <td style="background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%); border-radius: 8px; text-align: center; padding: 0;">
                <a href="${actionButton.url}" target="_blank" style="display: inline-block; padding: 14px 36px; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px; letter-spacing: 0.3px; background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%);">
                  ${actionButton.text}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    ` : '';

    const footerNote = footerText ? `
      <tr>
        <td style="padding: 15px 0 0;">
          <p style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #6B7280; margin: 0 0 10px;">${footerText}</p>
        </td>
      </tr>
    ` : '';

    const unsubscribeHtml = showUnsubscribe ? `
      <tr>
        <td style="padding: 10px 0 0;">
          <p style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.5; color: #9CA3AF; margin: 0;">
            If you'd prefer not to receive these emails, you can
            <a href="${this.baseUrl}/settings/notifications" target="_blank" style="color: #2563EB; text-decoration: underline;">update your notification preferences</a>.
          </p>
        </td>
      </tr>
    ` : '';

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <title>${title} - ${this.brandName}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #F3F4F6; -webkit-font-smoothing: antialiased;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #F3F4F6; min-width: 100%;">
          <tr>
            <td align="center" style="padding: 20px 10px;">
              <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);">

                ${logoHtml}

                <tr>
                  <td style="padding: 0 40px 10px; text-align: center;">
                    <h1 style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 22px; font-weight: 700; color: #111827; margin: 0; line-height: 1.3;">
                      ${title}
                    </h1>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 0 40px 30px;">
                    <div style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.7; color: #374151;">
                      ${htmlContent}
                    </div>
                  </td>
                </tr>

                ${buttonHtml}

                ${footerNote}

                <tr>
                  <td style="padding: 10px 40px 5px; border-top: 1px solid #E5E7EB;">
                    <p style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.5; color: #6B7280; margin: 15px 0 5px; text-align: center;">
                      <strong style="color: #374151;">${this.brandName}</strong> &mdash; ${this.tagline}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 0 40px 5px; text-align: center;">
                    <p style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.5; color: #9CA3AF; margin: 0;">
                      <a href="${this.baseUrl}" target="_blank" style="color: #2563EB; text-decoration: none; font-weight: 500;">${this.baseUrl}</a>
                    </p>
                  </td>
                </tr>

                ${unsubscribeHtml}

                <tr>
                  <td style="padding: 5px 40px 25px; text-align: center;">
                    <p style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.5; color: #D1D5DB; margin: 0;">
                      &copy; ${new Date().getFullYear()} ${this.brandName}. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  // Build a complete email ready for sendEmail
  buildEmail(subject, title, htmlContent, options = {}) {
    return {
      subject,
      html: this.wrapContent(title, htmlContent, options),
    };
  }
}

module.exports = new EmailTemplate();
