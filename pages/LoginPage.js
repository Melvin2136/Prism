'use strict';

const BASE_URL = 'https://prism-opc-dev.gnxsolutions.app';

class LoginPage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;

    // Locators — confirmed against live PRISM app
    this.emailInput    = page.getByRole('textbox', { name: /email/i });
    this.passwordInput = page.getByRole('textbox', { name: /password/i });
    this.signInButton  = page.getByRole('button',  { name: /sign in/i });
    this.rememberMeCheckbox  = page.getByRole('checkbox', { name: /remember me/i });
    this.forgotPasswordLink  = page.getByRole('button',   { name: /forgot password/i });
  }

  /** Navigate to the PRISM login page and wait until it is ready. */
  async goto() {
    await this.page.goto(`${BASE_URL}/login`);
    await this.page.waitForLoadState('domcontentloaded');
    await this.emailInput.waitFor({ state: 'visible' });
  }

  /**
   * Fill credentials and submit, then wait until the browser leaves /login.
   * @param {string} email
   * @param {string} password
   */
  async login(email, password) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
    await this.page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 20_000,
    });
  }
}

module.exports = { LoginPage };
