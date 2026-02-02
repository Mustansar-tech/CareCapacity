import { chromium, Browser, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

// Branch name mapping: Dashboard display name -> People Planner franchise name
const BRANCH_FRANCHISE_MAP: Record<string, string> = {
  'Glasgow North': 'Glasgow North',
  'Glasgow North - Kirkintilloch': 'Glasgow North - Kirkintilloch', 
  'Glasgow North - Live-In Care': 'Glasgow North - Live-In Care',
  'North Lanarkshire & Glasgow East': 'North Lanarkshire & Glasgow East',
  'North Lanarkshire & Glasgow East - Live In Care': 'North Lanarkshire & Glasgow East - Live In Care',
};

// Export template names used in People Planner
const EXPORT_TEMPLATES = {
  visits: 'Care Pro Guaranteed Hours',
  caregivers: 'CG Data Export',
  availability: 'CAREGiver Availability',
};

export interface PPCredentials {
  clientId: string;
  username: string;
  password: string;
}

export interface PPExportConfig {
  branchName: string;
  startDate: string; // Format: DD/MM/YYYY
  endDate: string;   // Format: DD/MM/YYYY
}

export interface PPExportResult {
  success: boolean;
  files: {
    visits?: string;
    caregivers?: string;
    availability?: string;
  };
  errors: string[];
}

class PeoplePlannerAutomation {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private downloadDir: string;

  constructor() {
    this.downloadDir = path.join(process.cwd(), 'downloads', 'pp-exports');
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  private getFranchiseName(branchName: string): string {
    return BRANCH_FRANCHISE_MAP[branchName] || branchName;
  }

  async initialize(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await this.browser.newContext({
      acceptDownloads: true,
    });
    
    this.page = await context.newPage();
  }

  async login(credentials: PPCredentials): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');

    try {
      console.log('🌐 Navigating to login page...');
      await this.page.goto('https://www.peopleplanner.biz/Security/login.aspx', { waitUntil: 'domcontentloaded' });
      
      // Step 1: Client ID login
      console.log('👤 Entering Client ID...');
      // Target first text input inside the form (ASP.NET WebForms safe)
      const clientIdInput = this.page.locator('form input[type="text"]').first();
      await clientIdInput.waitFor({ state: 'visible', timeout: 30000 });
      await clientIdInput.fill(credentials.clientId);
      
      // Submit with the first submit button/input in the form
      await this.page.locator('form input[type="submit"], form button').first().click();
      await this.page.waitForLoadState('networkidle');

      // Step 2: Select People Planner Account portal
      console.log('🔗 Selecting account portal...');
      const ppTile = this.page.locator('div', {
        hasText: 'Access People Planner'
      });
      await ppTile.waitFor({ state: 'visible', timeout: 30000 });
      await ppTile.click();
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(1500);

      // Step 3: Username/password login
      console.log('🔐 Entering credentials...');
      // Target by type and index for ASP.NET pages
      const usernameInput = this.page.locator('input[type="text"]').first();
      await usernameInput.waitFor({ state: 'visible', timeout: 30000 });
      await usernameInput.fill(credentials.username);

      const passwordInput = this.page.locator('input[type="password"]').first();
      await passwordInput.fill(credentials.password);

      await this.page.locator('input[type="submit"], button').first().click();
      await this.page.waitForLoadState('networkidle');

      // Step 4: Verify dashboard loads
      await this.page.waitForSelector('text=Dashboard', { timeout: 30000 });
      
      console.log('✅ Successfully logged into People Planner');
      return true;
    } catch (error) {
      console.error('❌ Login failed:', error);
      if (this.page) {
        const screenshotPath = path.join(process.cwd(), 'downloads', 'pp-login-failure.png');
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Screenshot saved to ${screenshotPath}`);
      }
      return false;
    }
  }

  private async navigateToReports(): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');
    
    await this.page.click('text=Reports');
    await this.page.waitForLoadState('networkidle');
  }

  private async downloadFile(exportName: string, branchName: string, startDate?: string, endDate?: string): Promise<string | null> {
    if (!this.page) throw new Error('Browser not initialized');

    const timestamp = Date.now();
    const safeExportName = exportName.replace(/[^a-z0-9]/gi, '_');
    const safeBranchName = branchName.replace(/[^a-z0-9]/gi, '_');
    const filename = `${safeExportName}_${safeBranchName}_${timestamp}.xlsx`;
    const filepath = path.join(this.downloadDir, filename);

    try {
      const downloadPromise = this.page.waitForEvent('download', { timeout: 60000 });
      
      // Click export button (could be img or button)
      await this.page.click('img[alt="Export"], button:has-text("Export"), input[value="Export"]');
      
      const download = await downloadPromise;
      await download.saveAs(filepath);
      
      console.log(`✅ Downloaded ${exportName} to ${filepath}`);
      return filepath;
    } catch (error) {
      console.error(`❌ Failed to download ${exportName}:`, error);
      return null;
    }
  }

  async exportVisits(config: PPExportConfig): Promise<string | null> {
    if (!this.page) throw new Error('Browser not initialized');

    try {
      await this.navigateToReports();
      
      // Navigate: Scheduling -> Exports -> Visits
      await this.page.hover('text=Scheduling');
      await this.page.hover('text=Exports');
      await this.page.click('li:has-text("Scheduling") >> text=Visits');
      await this.page.waitForLoadState('networkidle');

      // Select franchise
      const franchiseName = this.getFranchiseName(config.branchName);
      await this.page.selectOption('select[name*="Franchise"], select[id*="Franchise"]', { label: franchiseName });

      // Set dates
      await this.page.fill('input[name*="StartDate"], input[id*="StartDate"]', config.startDate);
      await this.page.fill('input[name*="EndDate"], input[id*="EndDate"]', config.endDate);

      // Set export type to Excel
      await this.page.selectOption('select[name*="ExportType"], select[id*="ExportType"]', { label: 'Excel' });

      // Select template if dropdown exists
      const templateSelect = await this.page.$('select[name*="Template"], select[id*="Template"]');
      if (templateSelect) {
        await templateSelect.selectOption({ label: EXPORT_TEMPLATES.visits });
      }

      return await this.downloadFile('Visits', config.branchName, config.startDate, config.endDate);
    } catch (error) {
      console.error('❌ Failed to export Visits:', error);
      return null;
    }
  }

  async exportCaregivers(config: PPExportConfig): Promise<string | null> {
    if (!this.page) throw new Error('Browser not initialized');

    try {
      await this.navigateToReports();
      
      // Navigate: CAREGivers -> Exports -> CAREGivers
      await this.page.hover('text=CAREGivers');
      await this.page.hover('li:has-text("CAREGivers") >> text=Exports');
      await this.page.click('li:has-text("CAREGivers") >> li:has-text("Exports") >> text=CAREGivers');
      await this.page.waitForLoadState('networkidle');

      // Select franchise
      const franchiseName = this.getFranchiseName(config.branchName);
      await this.page.selectOption('select[name*="Franchise"], select[id*="Franchise"]', { label: franchiseName });

      // Set export type to Excel
      await this.page.selectOption('select[name*="ExportType"], select[id*="ExportType"]', { label: 'Excel' });

      // Select template
      const templateSelect = await this.page.$('select[name*="Template"], select[id*="Template"]');
      if (templateSelect) {
        await templateSelect.selectOption({ label: EXPORT_TEMPLATES.caregivers });
      }

      // No dates needed for caregiver export
      return await this.downloadFile('Caregivers', config.branchName);
    } catch (error) {
      console.error('❌ Failed to export Caregivers:', error);
      return null;
    }
  }

  async exportAvailability(config: PPExportConfig): Promise<string | null> {
    if (!this.page) throw new Error('Browser not initialized');

    try {
      await this.navigateToReports();
      
      // Navigate: CAREGivers -> Exports -> CAREGiver Availability
      await this.page.hover('text=CAREGivers');
      await this.page.hover('li:has-text("CAREGivers") >> text=Exports');
      await this.page.click('text=CAREGiver Availability');
      await this.page.waitForLoadState('networkidle');

      // Select franchise
      const franchiseName = this.getFranchiseName(config.branchName);
      await this.page.selectOption('select[name*="Franchise"], select[id*="Franchise"]', { label: franchiseName });

      // Set dates
      await this.page.fill('input[name*="StartDate"], input[id*="StartDate"]', config.startDate);
      await this.page.fill('input[name*="EndDate"], input[id*="EndDate"]', config.endDate);

      // Set export type to Excel
      await this.page.selectOption('select[name*="ExportType"], select[id*="ExportType"]', { label: 'Excel' });

      // Select template if available
      const templateSelect = await this.page.$('select[name*="Template"], select[id*="Template"]');
      if (templateSelect) {
        await templateSelect.selectOption({ label: EXPORT_TEMPLATES.availability });
      }

      return await this.downloadFile('Availability', config.branchName, config.startDate, config.endDate);
    } catch (error) {
      console.error('❌ Failed to export Availability:', error);
      return null;
    }
  }

  async runFullExport(credentials: PPCredentials, config: PPExportConfig): Promise<PPExportResult> {
    const result: PPExportResult = {
      success: false,
      files: {},
      errors: [],
    };

    try {
      await this.initialize();
      
      const loggedIn = await this.login(credentials);
      if (!loggedIn) {
        result.errors.push('Failed to log in to People Planner');
        return result;
      }

      // Export all three files
      const visitsFile = await this.exportVisits(config);
      if (visitsFile) {
        result.files.visits = visitsFile;
      } else {
        result.errors.push('Failed to export Visits');
      }

      const caregiversFile = await this.exportCaregivers(config);
      if (caregiversFile) {
        result.files.caregivers = caregiversFile;
      } else {
        result.errors.push('Failed to export Caregivers');
      }

      const availabilityFile = await this.exportAvailability(config);
      if (availabilityFile) {
        result.files.availability = availabilityFile;
      } else {
        result.errors.push('Failed to export Availability');
      }

      result.success = Object.keys(result.files).length === 3;
      
    } catch (error) {
      result.errors.push(`Automation error: ${error}`);
    } finally {
      await this.close();
    }

    return result;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

// Export helper function to convert week dates to PP format (DD/MM/YYYY)
export function formatDateForPP(dateStr: string): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Get list of available branches for PP automation
export function getAvailableBranches(): { name: string; franchiseName: string }[] {
  return Object.entries(BRANCH_FRANCHISE_MAP).map(([name, franchiseName]) => ({
    name,
    franchiseName,
  }));
}

export { PeoplePlannerAutomation };
