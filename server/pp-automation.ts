import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const BRANCH_FRANCHISE_MAP: Record<string, string> = {
  'Glasgow North': 'Glasgow North',
  'Glasgow North - Kirkintilloch': 'Glasgow North - Kirkintilloch', 
  'Glasgow North - Live-In Care': 'Glasgow North - Live-In Care',
  'North Lanarkshire & Glasgow East': 'North Lanarkshire & Glasgow East',
  'North Lanarkshire & Glasgow East - Live In Care': 'North Lanarkshire & Glasgow East - Live In Care',
};

const REQUIRED_EXPORTS = {
  cgDataExport: {
    name: 'CG Data Export',
    filename: 'CG Data Export.xlsx',
    requiresDates: false,
    menuPath: ['CAREGivers', 'Exports', 'CAREGivers'],
  },
  careProGuaranteedHours: {
    name: 'Care Pro Guaranteed Hours',
    filename: 'Care Pro Guaranteed Hours.xlsx',
    requiresDates: true,
    menuPath: ['Scheduling', 'Exports', 'Visits'],
  },
  availabilityExport: {
    name: 'Availability Export',
    filename: 'Availability Export.xlsx',
    requiresDates: true,
    menuPath: ['CAREGivers', 'Exports', 'CAREGiver Availability'],
  },
};

export interface PPExportConfig {
  branchName: string;
  startDate: string;
  endDate: string;
  edgeProfilePath?: string;
}

export interface PPExportResult {
  success: boolean;
  files: {
    cgDataExport?: string;
    careProGuaranteedHours?: string;
    availabilityExport?: string;
  };
  errors: string[];
  requiresManualLogin?: boolean;
  invalidSession?: boolean;
}

class PeoplePlannerAutomation {
  private context: BrowserContext | null = null;
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

  private getDefaultEdgeProfilePath(): string {
    const username = os.userInfo().username;
    return `C:/Users/${username}/AppData/Local/Microsoft/Edge/User Data`;
  }

  async initialize(): Promise<{ success: boolean; error?: string }> {
    console.log('🌐 Launching Edge browser...');
    
    try {
      this.context = await chromium.launchPersistentContext('', {
        channel: 'msedge',
        headless: false,
        acceptDownloads: true,
        viewport: { width: 1920, height: 1080 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
      });

      // 🔒 HARD BLOCK: close any extra pages (like about:blank) immediately
      this.context.on('page', async (new_page) => {
        const pages = this.context?.pages() || [];
        if (pages.length > 1) {
          await new_page.close().catch(() => {});
        }
      });

      this.page = this.context.pages()[0] || await this.context.newPage();
      console.log('✅ Edge browser launched successfully');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to launch Edge: ${errorMessage}`,
      };
    }
  }

  async validateSession(): Promise<{ valid: boolean; error?: string }> {
    if (!this.page) {
      return { valid: false, error: 'Browser not initialized' };
    }

    try {
      console.log('🔍 Navigating to People Planner...');
      // Using domcontentloaded to prevent redirect freeze often seen with the debugger
      await this.page.goto('https://www.peopleplanner.biz/', { 
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });

      await this.page.waitForTimeout(3000);

      const currentUrl = this.page.url();
      console.log(`📍 Current URL: ${currentUrl}`);

      if (currentUrl.includes('theaccessgroup.com') || currentUrl.includes('access-group.com')) {
        console.log('❌ Redirected to Access marketing site');
        await this.captureScreenshot('pp-invalid-session.png');
        return {
          valid: false,
          error: 'Invalid session / blocked environment - redirected to Access marketing site',
        };
      }

      if (currentUrl.includes('login.aspx') || currentUrl.includes('/Security/')) {
        console.log('❌ Session expired - login page detected');
        await this.captureScreenshot('pp-login-required.png');
        return {
          valid: false,
          error: 'Manual login required - session has expired',
        };
      }

      const dashboardVisible = await this.page.locator('text=Dashboard').first().isVisible({ timeout: 10000 }).catch(() => false);
      
      if (!dashboardVisible) {
        const reportsVisible = await this.page.locator('text=Reports').first().isVisible({ timeout: 5000 }).catch(() => false);
        
        if (!reportsVisible) {
          console.log('❌ Could not find expected dashboard elements');
          await this.captureScreenshot('pp-unexpected-page.png');
          return {
            valid: false,
            error: 'Unexpected page state - neither Dashboard nor Reports menu found',
          };
        }
      }

      console.log('✅ Valid session detected - logged in to People Planner');
      return { valid: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.captureScreenshot('pp-session-error.png');
      return {
        valid: false,
        error: `Session validation failed: ${errorMessage}`,
      };
    }
  }

  private async captureScreenshot(filename: string): Promise<void> {
    if (!this.page) return;
    try {
      const screenshotPath = path.join(this.downloadDir, filename);
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
    } catch (err) {
      console.log('⚠️ Failed to capture screenshot');
    }
  }

  private async navigateToExport(menuPath: string[]): Promise<boolean> {
    if (!this.page) return false;

    try {
      console.log(`📂 Navigating to: ${menuPath.join(' → ')}`);

      await this.page.click('text=Reports');
      await this.page.waitForTimeout(500);

      for (let i = 0; i < menuPath.length - 1; i++) {
        const menuItem = menuPath[i];
        await this.page.hover(`text=${menuItem}`);
        await this.page.waitForTimeout(300);
      }

      const lastItem = menuPath[menuPath.length - 1];
      await this.page.click(`text=${lastItem}`);
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await this.page.waitForTimeout(1000);

      console.log(`✅ Navigated to ${lastItem}`);
      return true;
    } catch (error) {
      console.error(`❌ Navigation failed: ${error}`);
      await this.captureScreenshot(`pp-nav-error-${Date.now()}.png`);
      return false;
    }
  }

  private async configureExportForm(branchName: string, startDate?: string, endDate?: string): Promise<boolean> {
    if (!this.page) return false;

    try {
      const franchiseName = this.getFranchiseName(branchName);
      console.log(`🏢 Selecting branch: ${franchiseName}`);

      const branchSelect = this.page.locator('select[name*="Franchise"], select[id*="Franchise"], select[name*="Branch"], select[id*="Branch"]').first();
      if (await branchSelect.isVisible({ timeout: 5000 })) {
        await branchSelect.selectOption({ label: franchiseName });
      }

      if (startDate && endDate) {
        console.log(`📅 Setting date range: ${startDate} - ${endDate}`);
        
        const startInput = this.page.locator('input[name*="StartDate"], input[id*="StartDate"], input[name*="From"], input[id*="From"]').first();
        const endInput = this.page.locator('input[name*="EndDate"], input[id*="EndDate"], input[name*="To"], input[id*="To"]').first();
        
        if (await startInput.isVisible({ timeout: 3000 })) {
          await startInput.clear();
          await startInput.fill(startDate);
        }
        
        if (await endInput.isVisible({ timeout: 3000 })) {
          await endInput.clear();
          await endInput.fill(endDate);
        }
      }

      const formatSelect = this.page.locator('select[name*="ExportType"], select[id*="ExportType"], select[name*="Format"], select[id*="Format"]').first();
      if (await formatSelect.isVisible({ timeout: 3000 })) {
        const options = await formatSelect.locator('option').allTextContents();
        const excelOption = options.find(opt => opt.toLowerCase().includes('excel'));
        if (excelOption) {
          await formatSelect.selectOption({ label: excelOption });
          console.log('📊 Export format set to Excel');
        }
      }

      return true;
    } catch (error) {
      console.error(`❌ Form configuration failed: ${error}`);
      return false;
    }
  }

  private async downloadExport(exportName: string, targetFilename: string): Promise<string | null> {
    if (!this.page) return null;

    try {
      console.log(`⬇️ Starting download for ${exportName}...`);

      const downloadPromise = this.page.waitForEvent('download', { timeout: 60000 });

      const exportButton = this.page.locator('input[type="submit"][value*="Export"], button:has-text("Export"), input[value="Export"], img[alt*="Export"]').first();
      
      if (await exportButton.isVisible({ timeout: 5000 })) {
        await exportButton.click();
      } else {
        const submitButton = this.page.locator('input[type="submit"], button[type="submit"]').first();
        await submitButton.click();
      }

      const download = await downloadPromise;
      const filepath = path.join(this.downloadDir, targetFilename);
      await download.saveAs(filepath);

      console.log(`✅ Downloaded: ${targetFilename}`);
      return filepath;
    } catch (error) {
      console.error(`❌ Download failed for ${exportName}: ${error}`);
      await this.captureScreenshot(`pp-download-error-${exportName.replace(/\s/g, '_')}.png`);
      return null;
    }
  }

  async exportCGDataExport(branchName: string): Promise<string | null> {
    const config = REQUIRED_EXPORTS.cgDataExport;
    
    if (!await this.navigateToExport(config.menuPath)) {
      return null;
    }

    if (!await this.configureExportForm(branchName)) {
      return null;
    }

    return await this.downloadExport(config.name, config.filename);
  }

  async exportCareProGuaranteedHours(branchName: string, startDate: string, endDate: string): Promise<string | null> {
    const config = REQUIRED_EXPORTS.careProGuaranteedHours;
    
    if (!await this.navigateToExport(config.menuPath)) {
      return null;
    }

    if (!await this.configureExportForm(branchName, startDate, endDate)) {
      return null;
    }

    return await this.downloadExport(config.name, config.filename);
  }

  async exportAvailability(branchName: string, startDate: string, endDate: string): Promise<string | null> {
    const config = REQUIRED_EXPORTS.availabilityExport;
    
    if (!await this.navigateToExport(config.menuPath)) {
      return null;
    }

    if (!await this.configureExportForm(branchName, startDate, endDate)) {
      return null;
    }

    return await this.downloadExport(config.name, config.filename);
  }

  async runFullExport(config: PPExportConfig): Promise<PPExportResult> {
    const result: PPExportResult = {
      success: false,
      files: {},
      errors: [],
    };

    try {
      const initResult = await this.initialize(config.edgeProfilePath);
      if (!initResult.success) {
        result.errors.push(initResult.error || 'Failed to initialize browser');
        return result;
      }

      const sessionResult = await this.validateSession();
      if (!sessionResult.valid) {
        if (sessionResult.error?.includes('Manual login required')) {
          result.requiresManualLogin = true;
        } else if (sessionResult.error?.includes('Invalid session')) {
          result.invalidSession = true;
        }
        result.errors.push(sessionResult.error || 'Session validation failed');
        return result;
      }

      console.log('\n📦 Starting export sequence...\n');

      const cgDataFile = await this.exportCGDataExport(config.branchName);
      if (cgDataFile) {
        result.files.cgDataExport = cgDataFile;
        console.log(`✅ CG Data Export: ${cgDataFile}`);
      } else {
        result.errors.push('Failed to export CG Data Export');
      }

      const guaranteedHoursFile = await this.exportCareProGuaranteedHours(
        config.branchName,
        config.startDate,
        config.endDate
      );
      if (guaranteedHoursFile) {
        result.files.careProGuaranteedHours = guaranteedHoursFile;
        console.log(`✅ Care Pro Guaranteed Hours: ${guaranteedHoursFile}`);
      } else {
        result.errors.push('Failed to export Care Pro Guaranteed Hours');
      }

      const availabilityFile = await this.exportAvailability(
        config.branchName,
        config.startDate,
        config.endDate
      );
      if (availabilityFile) {
        result.files.availabilityExport = availabilityFile;
        console.log(`✅ Availability Export: ${availabilityFile}`);
      } else {
        result.errors.push('Failed to export Availability Export');
      }

      result.success = Object.keys(result.files).length === 3;

      if (result.success) {
        console.log('\n🎉 All exports completed successfully!\n');
      } else {
        console.log(`\n⚠️ Export completed with ${result.errors.length} error(s)\n`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Automation error: ${errorMessage}`);
    } finally {
      await this.close();
    }

    return result;
  }

  async close(): Promise<void> {
    if (this.context) {
      console.log('🔒 Closing browser...');
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }
}

export function formatDateForPP(dateStr: string): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function getAvailableBranches(): { name: string; franchiseName: string }[] {
  return Object.entries(BRANCH_FRANCHISE_MAP).map(([name, franchiseName]) => ({
    name,
    franchiseName,
  }));
}

export function getRequiredExports(): typeof REQUIRED_EXPORTS {
  return REQUIRED_EXPORTS;
}

export { PeoplePlannerAutomation };
